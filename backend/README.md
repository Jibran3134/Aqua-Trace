# AquaTrace backend

FastAPI backend for simulated water-leak localization and crew investigation.
It uses real WNTR hydraulic simulations of Net3, PostgreSQL for durable scenarios,
and Redis for atomic request quotas and disposable public caches. Authentication
and frontend development are outside this backend's scope.

## Current implementation status

This initial team handoff contains the tested infrastructure, hydraulic simulator,
scenario generation, detector, network API and explicit reveal API. Investigation
routes are drafted but are not mounted until their services pass testing.
LLM integration, evaluation, sensor placement and repair optimization are in
progress. The endpoint table below describes the target contract; use the running
OpenAPI document to see which endpoints are currently available. Mock JSON files
let frontend work continue independently and are examples rather than live results.

## Run with Docker

Run these commands from this directory:

```text
python scripts/init_env.py
docker compose up --build -d
curl http://localhost:8000/health
```

Open [API documentation](http://localhost:8000/docs). Wait for
`signatures_ready: true` before creating scenarios. `/ready` also checks
PostgreSQL and Redis. Compose runs Alembic migrations before starting the API.
The generated `.env` contains local credentials; it is excluded from Git.

Ports, CORS origins, database connections, quotas and providers are configurable.
See [operations](docs/operations.md) for local Python 3.13 virtual-environment
setup, occupied-port handling, tests, backups and recovery. The `.venv` created
on a developer's device is local; Docker supplies the same runtime on other devices.

## API and frontend integration

The complete contract is in [docs/contracts/api.md](docs/contracts/api.md),
with event rendering guidance and JSON examples in
[docs/contracts/events.md](docs/contracts/events.md) and `mocks/`.

| Endpoint | Purpose |
|---|---|
| `GET /health`, `GET /ready` | Dependency and signature readiness |
| `GET /network` | Net3 nodes, links and default pressure sensors |
| `POST /scenario/leak` | Generate a hidden simulated leak and public readings |
| `POST /detect` | Rank observation-based leak candidates |
| `POST /agent/step` | Run a bounded investigation turn (in progress) |
| `POST /field/result` | Record crew evidence and update the ranking (in progress) |
| `GET /scenario/{id}/reveal` | Explicitly reveal simulated ground truth |
| `GET /eval` | Read the frozen benchmark report (in progress) |
| `POST /sensors/place` | Select sensors and report validation performance (in progress) |
| `POST /repair/optimize` | Select repairs under a supplied budget (in progress) |

Start by posting `{"seed":7,"noise":"mid"}` to `/scenario/leak`.
Pass its `scenario_id` to `/detect` and `/agent/step`. Crew reports include
`scenario_id`, a candidate `node`, and the boolean `found`.
Only the reveal endpoint identifies the true simulated leak. Scores are relative
fit scores, not probabilities; candidate IDs can include the true node without
identifying it as truth. All pressures and leak-flow estimates are simulated.

Gemini and Groq are optional. Set their credentials and model names in `.env`;
missing credentials, provider failures or `DEMO_MODE=true` use the deterministic
scripted investigator. LLMs have bounded, validated, read-only tools and cannot
submit crew reports, access credentials or read hidden truth. Provider text is
never shown as factual output. See [security](docs/security.md).

## Architecture and maintenance

Routes in `app/api/` validate DTOs and coordinate domain services. Hydraulics,
detection, investigation, optimization and evaluation live in separate modules.
SQLAlchemy repositories own persistence boundaries; Alembic owns schema changes.
Scenario revisions and database row locks protect concurrent updates. Redis
caches public data only; Redis Lua implements atomic quotas using server time.

PostgreSQL uses portable UUID, JSONB and timestamp types without Supabase-specific
auth dependencies. Connection settings support a separate migration connection,
TLS and hosted poolers. Follow [the migration guide](docs/supabase-migration.md)
when moving to Supabase.

The [documentation index](docs/README.md) identifies the source of truth for
contracts, decisions and measured validation. `AGENTS.md` gives maintenance rules.
The original team plan is retained as reference material; the current backend
requirements and implemented contracts take precedence.

## Verification and limits

```text
python scripts/test.py -q
python scripts/test.py --integration -q
```

Run these with the backend virtual environment after installing
`requirements-dev.txt`. Integration tests require migrated PostgreSQL and Redis.
Actual test results and model diagnostics are recorded in
[docs/validation.md](docs/validation.md).

Net3 is a benchmark stand-in, not a utility survey. Localization is at junction
level, assumes one leak and uses one steady-state snapshot. Synthetic demand,
noise and rupture sizes are documented in [hydraulics](docs/hydraulics.md).
Pipe-graph routes are simulated infrastructure lengths, not road travel routes.
Sensor-placement accuracy is validation-set performance. Repair savings assume
independent leaks and costs supplied by the caller or explicitly labeled defaults.
