"""Integration checks that guard the frontend/backend seam.

Run from the repo root:

    pytest tests/integration                      # in-process (imports backend.main:app)
    AQUATRACE_URL=http://localhost:8000 pytest tests/integration   # against a running server

Env knobs:
    AQUATRACE_URL   hit a live server instead of importing the app
    SIG_WAIT_S      seconds to wait for the signature library (default 600)
    LEAK_SEEDS      number of seeds for the truth-leak test (default 20)

If backend/main.py does not exist yet, every test is skipped (not failed).
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
VITE_ORIGIN = "http://localhost:5173"

# Make `import backend.main` work when pytest is launched from anywhere.
sys.path.insert(0, str(ROOT))


def _wait_until_ready(c: httpx.Client) -> None:
    """Poll /health until the signature library is built; fail loudly on timeout."""
    deadline = time.monotonic() + float(os.environ.get("SIG_WAIT_S", "600"))
    last = None
    while time.monotonic() < deadline:
        r = c.get("/health")
        last = r.text
        if r.status_code == 200 and r.json().get("signatures_ready"):
            return
        time.sleep(2)
    pytest.fail(f"signatures not ready before timeout; last /health: {last}")


@pytest.fixture(scope="session")
def client():
    url = os.environ.get("AQUATRACE_URL")
    if url:
        with httpx.Client(base_url=url, timeout=120) as c:
            _wait_until_ready(c)
            yield c
        return

    if not (ROOT / "backend" / "main.py").exists():
        pytest.skip("backend/main.py does not exist yet")

    from fastapi.testclient import TestClient
    from backend.main import app  # noqa: E402  (import errors should fail, not skip)

    # `with` runs startup/lifespan so the signature build thread starts.
    with TestClient(app) as c:
        _wait_until_ready(c)
        yield c


@pytest.fixture(scope="session")
def network(client):
    r = client.get("/network")
    assert r.status_code == 200, r.text
    return r.json()


def new_scenario(client, seed: int, **extra) -> dict:
    """Create a scenario and return the (truth-free) response body."""
    r = client.post("/scenario/leak", json={"seed": seed, "noise": "mid", **extra})
    assert r.status_code == 200, f"/scenario/leak -> {r.status_code}: {r.text}"
    return r.json()
