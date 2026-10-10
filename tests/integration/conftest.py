"""Integration checks that guard the frontend/backend seam.

The backend lives at backend/app/main.py and needs PostgreSQL + Redis, so the
practical way to run these is against a running stack:

    cd backend; docker compose up --build -d
    AQUATRACE_URL=http://localhost:8000 pytest tests/integration

Without AQUATRACE_URL we import backend/app/main.py in-process, which still
needs reachable PostgreSQL and Redis.

Env knobs:
    AQUATRACE_URL   hit a live server instead of importing the app
    SIG_WAIT_S      seconds to wait for the signature library (default 900)
    LEAK_SEEDS      seeds for the truth-leak sweep (default 8; see rate limits)

The backend rate-limits expensive endpoints (10 burst, 0.1/s refill), so a long
sweep throttles. Requests retry on 429. For a full 20-seed run, start the
backend with RATE_LIMIT_ENABLED=false.

If the backend app is absent, every test skips instead of failing. If it is
present but unusable, we fail loudly rather than skipping, so a broken stack can
never look like a pass.
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[2]
MOCKS = ROOT / "mocks"
BACKEND = ROOT / "backend"
APP_MAIN = BACKEND / "app" / "main.py"
VITE_ORIGIN = "http://localhost:5173"

# Error codes the backend uses for "this route is not mounted".
NOT_IMPLEMENTED_CODES = {"http_error", "not_found"}


def error_code(response) -> str | None:
    """Return the {error:{code}} value, or None if the body is not an error envelope."""
    try:
        body = response.json()
    except Exception:
        return None
    if isinstance(body, dict) and isinstance(body.get("error"), dict):
        code = body["error"].get("code")
        return code if isinstance(code, str) else None
    return None


def route_missing(response) -> bool:
    """True when a 404 means 'endpoint not implemented yet' rather than 'unknown scenario'."""
    if response.status_code not in (404, 405):
        return False
    code = error_code(response)
    # FastAPI's bare {"detail": ...}, or the backend's generic http_error envelope.
    return code is None or code in NOT_IMPLEMENTED_CODES


class Client:
    """httpx wrapper that waits out throttling, since a 429 is backpressure, not a failure."""

    #: Total seconds to spend waiting on one request before giving up.
    THROTTLE_BUDGET_S = 240.0

    def __init__(self, inner: httpx.Client) -> None:
        self._inner = inner

    def request(self, method: str, path: str, **kw):
        spent = 0.0
        while True:
            r = self._inner.request(method, path, **kw)
            if r.status_code != 429:
                return r
            wait = min(float(r.headers.get("Retry-After") or 2), 15.0)
            if spent + wait > self.THROTTLE_BUDGET_S:
                pytest.fail(
                    f"{method} {path} stayed rate-limited for {spent:.0f}s. Restart the backend "
                    "with RATE_LIMIT_ENABLED=false (see backend/.env) for this suite."
                )
            time.sleep(wait)
            spent += wait

    def get(self, path, **kw):
        return self.request("GET", path, **kw)

    def post(self, path, **kw):
        return self.request("POST", path, **kw)


def _wait_until_ready(c: Client) -> None:
    """Poll /health until signatures are built; fail with the dependency status on timeout."""
    deadline = time.monotonic() + float(os.environ.get("SIG_WAIT_S", "900"))
    last = "<no response>"
    while time.monotonic() < deadline:
        try:
            r = c.get("/health")
        except httpx.HTTPError as e:
            pytest.fail(
                f"Cannot reach the backend: {e}\n"
                "Start it with: cd backend; docker compose up --build -d"
            )
        last = r.text
        if r.status_code == 200:
            body = r.json()
            # Field name differs from the frontend contract; accept either.
            if body.get("signatures_ready"):
                for dep in ("database", "redis"):
                    if body.get(dep) not in (None, "ok"):
                        pytest.fail(
                            f"Backend reports {dep}={body[dep]!r}. These tests need a working "
                            f"stack. Start it with: cd backend; docker compose up --build -d"
                        )
                return
        time.sleep(3)
    pytest.fail(f"signatures not ready before timeout; last /health: {last}")


@pytest.fixture(scope="session")
def client():
    url = os.environ.get("AQUATRACE_URL")
    if url:
        with httpx.Client(base_url=url, timeout=120) as inner:
            c = Client(inner)
            _wait_until_ready(c)
            yield c
        return

    if not APP_MAIN.exists():
        pytest.skip(f"{APP_MAIN.relative_to(ROOT)} does not exist yet")

    # The backend is not a package; its modules import as `app.*` from backend/.
    sys.path.insert(0, str(BACKEND))
    from fastapi.testclient import TestClient  # noqa: E402
    from app.main import app  # noqa: E402  import errors must fail, not skip

    with TestClient(app) as inner:
        c = Client(inner)
        _wait_until_ready(c)
        yield c


@pytest.fixture(scope="session")
def network(client):
    r = client.get("/network")
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="session")
def scenario(client):
    """One scenario shared by read-only shape tests.

    /scenario/leak sits in the backend's "expensive" quota (10 burst, then 0.1/s),
    so creating one per test turns the suite into a queue. Tests that mutate
    investigation state still make their own.
    """
    return new_scenario(client, 1015)


def new_scenario(client, seed: int, **extra) -> dict:
    """Create a scenario and return the (truth-free) response body."""
    r = client.post("/scenario/leak", json={"seed": seed, "noise": "mid", **extra})
    assert r.status_code == 200, f"/scenario/leak -> {r.status_code}: {r.text}"
    return r.json()
