# Architecture and invariants

Modular FastAPI monolith. Sync endpoints run in the framework thread pool;
WNTR calculations use a bounded semaphore. Lifespan owns resource pools.

`api` → validated `schemas` → domain services → `db`/`infra` adapters.
`hydraulics` owns physics/signatures; `detection` owns generation/ranking;
`investigation` owns tools/providers; `optimization` owns placement/repairs;
`evaluation` owns benchmark seeds. Internal domain models are never HTTP DTOs.

PostgreSQL schemas `aquatrace` and `aquatrace_private` separate observations and
truth. Transactions, row locks and revisions govern state changes. JSONB stores
sensor vectors/events; UUIDs, UTC timestamps, foreign keys and constraints define
durable identity. Alembic migrations run before API startup, once per deployment.

Redis stores atomic token-bucket quotas and public cache outputs. Cache identity
includes computation fingerprint and scenario revision. Cache failures permit
recomputation; enabled quota failures return 503. PostgreSQL is authoritative.

Detector inputs are readings, sensor IDs, noise assumptions and signatures, never
truth. LLM inputs are bounded read-only tool outputs, never full pressures, seeds,
private tables or credentials. Only explicit crew HTTP reports mutate outcomes.

Provider calls use state snapshots without database locks. History writes use
expected revisions; a simultaneous crew change returns retryable 409. Duplicate
reports never shrink weights twice. No authentication or multi-tenancy is added.

Observations carry internal hydraulic and detector fingerprints in their JSONB
record. API reads reject incompatible or unversioned legacy scenarios with 409
and a new-scenario hint. A Redis cache miss cannot repair an obsolete persisted
ranking; unchanged application restarts continue reading compatible scenarios.

This is synthetic, single-leak, steady-state localization on a benchmark network.
It does not claim live telemetry, real driving routes or field accuracy.
