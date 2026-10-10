# Validation record

Environment: Windows x86-64, Python 3.13.16, WNTR 1.5.0; PostgreSQL 17 and
Redis 7.4 in Docker. Results below are measured on 2026-10-10, not field data.

## Module 1: infrastructure and contract

- Alembic `upgrade head`: revision `0001_scenarios` applied successfully.
- Unit/contract selection: **35 passed, 4 deselected**, measured 2.24 seconds.
- Live infrastructure/contract selection: **39 passed**, measured 25.54 seconds.
- PostgreSQL: commit/reload, isolated truth reads, stale revision rejection,
  expiry cleanup and cascading truth deletion verified.
- Redis: 50 simultaneous requests against a seven-token bucket admitted exactly
  seven; TTL and owner-checked lock release verified on a real server.
- Input boundaries: strict DTOs, chunked body limit, CORS on unexpected errors,
  secret redaction and finite/public-only cache values verified.
- One upstream Starlette TestClient/httpx deprecation warning; no test failures.

Later module results and final full-suite/container checks will be added here
after execution. Pending work is not evidence of passing tests.

## Module 2a: hydraulic service

- **11 tests passed**, measured 3.23 seconds.
- Real baseline/leak simulation, local pressure reduction, determinism,
  pristine-template protection, junction membership and retry boundaries verified.
- Native solver differences around 1.4e-14 metres are quantized at eight decimal
  places for reproducible JSON, far below the smallest assumed sensor noise.
- Net3 junction 10 has baseline negative pressure; this inherited benchmark state
  is documented and preserved. An active leak there cannot generate positive flow.
- SciPy warns about fitting a three-point pump curve; convergence and finite
  result checks pass. No solver failure is silently reported as a success.

## Module 2b: calibrated signature library

- **15 hydraulic/signature tests passed**, measured 29.14 seconds.
- Matrix: 97 network nodes × 91 usable leak candidates, immutable float32.
  Candidate 10 is explicitly skipped because it cannot produce positive leak flow.
- Measured build: 12.634 seconds; measured cached load: 0.014 seconds.
- Thread coordination, corruption recovery, hash invalidation and atomic
  publication/replacement verified.
- Fifteen calibration runs over five fixed junctions converged without retries.
  Small/medium/large areas are assumed 0.006/0.012/0.020 m²; the smallest local
  small-leak drop was simulated 0.304 metres, exceeding the calibration criterion.
- Full measured calibration and signature metadata: `data/calibration.json` and
  `data/signature_validation.json`; these sizes are benchmark assumptions.

## Module 3a: seeded scenario generator

- **12 tests passed**, measured 2.73 seconds.
- Continuous area jitter, random demand mismatch, Gaussian noise and dropout
  are deterministic and isolated from the detector's fixed signatures.
- Sensor readings remain stable across reordered/subset selections.
- Signature-ineligible junctions are not selected as hidden truth; explicit
  known junction 10 remains a permitted but uninformative sensor input.
