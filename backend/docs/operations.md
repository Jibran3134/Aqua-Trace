# Run and operate the backend

Run commands below from `backend/`. Docker Engine with Compose and Python are
required for the three-command setup; local development uses Python 3.13. The
container supplies its own pinned Python runtime and dependencies. No frontend
or authentication service is installed.

## Clean checkout with Docker

```text
python scripts/init_env.py
docker compose up --build -d
curl http://localhost:8000/health
```

`init_env.py` generates distinct database and Redis secrets in `.env` and preserves
an existing file. Compose starts PostgreSQL 17 and Redis 7.4, waits for healthy
dependencies, runs Alembic as a separate migration job, then starts the API.
Database data, Redis data and hydraulic artifacts use named Docker volumes.
API docs are available at `http://localhost:8000/docs`.

Hydraulic signatures may still be building after process startup. `/health`
reports readiness/progress, and dependent endpoints return a readable 503 until
signatures are ready. Read `docs/hydraulics.md` for physics, calibration and timing.
The deployment's actual validation results are recorded in `docs/validation.md`.

Default ports are API 8000, PostgreSQL 5432 and Redis 6379. If PostgreSQL's port is
already occupied, change `POSTGRES_PORT`, `DATABASE_URL` and
`MIGRATION_DATABASE_URL` consistently in `.env`; for example use local port 15432.
The API container uses Docker service hostnames rather than host-mapped ports.
For an occupied API port, change `API_PORT` and the frontend's API base URL.

## Local Python virtual environment

Create a local environment; virtual environments are device-specific and are not
committed. Install the exact runtime and test versions from `requirements-dev.txt`.
The container uses the separate runtime-only `requirements.txt` lock.

Windows PowerShell:

```text
py -3.13 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
python scripts/init_env.py
docker compose up -d postgres redis
.venv\Scripts\python.exe -m alembic upgrade head
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --no-proxy-headers
```

Linux/macOS:

```text
python3.13 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
python3 scripts/init_env.py
docker compose up -d postgres redis
.venv/bin/python -m alembic upgrade head
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --no-proxy-headers
```

Use that same environment's Python for all CLI work. Activate the environment if
you prefer shorter `python` commands. Native Apple Silicon/x86 and Windows wheels
must be validated on their target devices; committed source is portable, while
the generated `.venv` is not. The Docker build is the common runtime path.
The explicit `--no-proxy-headers` keeps client identity tied to the socket peer
for local request quotas. A reverse-proxy deployment needs an intentional trusted
proxy policy rather than accepting caller-supplied forwarding headers.

## Settings and migrations

`app/core/config.py` reads `backend/.env` independently of the current directory;
environment variables override file values. `.env.example` lists supported
deployment values. Do not commit the generated `.env`.

`DATABASE_URL` is the application connection. Optional `MIGRATION_DATABASE_URL`
is Alembic's privileged direct/session connection; absent it, migrations use the
application URL. Supply separate database roles in deployments needing narrower
runtime privileges. Run `alembic upgrade head` once per deployment before serving
requests. Runtime never calls `create_all`. Sessions are short-lived and commits
are explicit; scenario revisions prevent overwriting concurrent crew reports.

Keep application pool sizing within the database connection budget across all
replicas: each replica permits `DATABASE_POOL_SIZE + DATABASE_MAX_OVERFLOW`
connections. Scenario expiry is controlled by `SCENARIO_TTL_HOURS`; cleanup also
retains only the newest `SCENARIO_MAX_COUNT` records. Deleting observations cascades
to their truth rows.

LLM keys are optional. Missing keys, `LLM_ENABLED=false` or `DEMO_MODE=true` use
the deterministic scripted investigator. Provider base URLs/model names are
settings rather than frontend input. See `security.md` for execution boundaries.

## Tests

After dependencies and migrations are installed:

```text
python scripts/test.py -q
python scripts/test.py --integration tests/test_infrastructure.py tests/test_contract.py -q
```

`--integration` privately loads the configured URLs into the test process. Explicit
`AQUATRACE_TEST_DATABASE_URL` and `AQUATRACE_TEST_REDIS_URL` override these defaults;
use them for dedicated test infrastructure. Real integration tests verify
PostgreSQL commit/reload, stale writers, expiry/cascades and Redis concurrent Lua
quotas/lock ownership. Without live test URLs, those fixtures skip. Ordinary
contract tests do not require configured LLM credentials. Unit tests do not prove
real Lua atomicity or PostgreSQL compatibility.

## Failures and recovery

Cache outages become misses/recomputation; failed cache writes do not fail the
response. Enabled Redis rate-limit outages return 503 by default. PostgreSQL
failures affect durable operations. Readiness and error hints show the appropriate
next action; keep Redis available for quotas even when cached values are disposable.
Use `docker compose ps` and `docker compose logs api migrate` for diagnosis without
dumping interpolated configuration/secrets.

`docker compose stop` preserves volumes. Restart with `docker compose up -d`.
Avoid deleting volumes during routine recovery. Corrupt/outdated hydraulic
artifacts should be rebuilt using their network/config fingerprint; do not
replace physical simulation with silently fabricated cache values.

For a database backup with the default database/user names, write the binary
archive inside the container before copying it. This also avoids binary corruption
from older PowerShell native-command redirection:

```text
docker compose exec -T postgres pg_dump --username=aquatrace --dbname=aquatrace --no-owner --no-privileges --format=custom --file=/tmp/aquatrace.dump
docker compose cp postgres:/tmp/aquatrace.dump ./aquatrace.dump
```

Replace database/user names if configured differently. The dump contains private
truth and must remain private. Test restoration into an empty disposable database;
never assume that producing a dump proves recovery. Hosted migration and TLS
settings are documented in `supabase-migration.md`.
