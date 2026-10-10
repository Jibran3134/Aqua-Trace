# AquaTrace

Decision support for water utilities: infer a hidden leak's location from a handful of pressure
sensors, then run an investigator agent that plans a crew route, re-ranks after "nothing found here",
and says so honestly when the evidence is not enough.

```
aquatrace/
  contracts/api.md   # endpoint shapes — the source of truth (v1.1)
  mocks/*.json       # sample responses generated from the in-browser mock engine
  backend/           # FastAPI + WNTR (owned by the backend team)
  frontend/          # React 19 + Vite + TS + Tailwind v4 + Cytoscape + react-three-fiber
```

## Run the frontend (3 commands)

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173  (port is fixed: the backend allows CORS for it)
```

By default the UI runs against the **in-browser mock engine**, so the whole demo works offline
(verified with all external requests blocked). To use the real backend, create `frontend/.env.local`:

```
VITE_USE_MOCKS=false
VITE_API_URL=http://localhost:8000
```

If the backend is unreachable the UI says so, shows the command to start it, and offers Retry.

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on :5173 |
| `npm run build` | Type-check + production build (`dist/`) |
| `npm test` | Vitest: contract guarantees of the mock, repair optimizer vs brute force |
| `npm run mocks` | Regenerate `mocks/*.json` from the mock engine |

## The demo

Open the app → 3D intro → **Enter** → console (`#/console`). Pick a scenario in the top bar:

| Preset | Story |
|---|---|
| **Demo A** (seed 897) | Crew misses once, the agent re-ranks, the second visit finds it |
| **Demo B** (seed 101) | Small leak in high noise: honest no-call → add the recommended sensor → #1 |
| Random | One live, unscripted scenario (say so out loud) |

The **Next** chip on the map always offers the next step. Presenter shortcuts (press `?`):

`S` simulate · `D` detect · `A` add recommended sensor · `I` investigate · `C` send simulated crew ·
`V` reveal · `P` report · `R` reset map · `1–5` tabs

Demo seeds are verified on the **mock**. Once the backend is up, re-verify and override without
code changes: `VITE_DEMO_SEEDS=[{"id":"A","label":"Demo A","story":"…","seed":123,"size":"medium","noise":"mid","k":6}]`.

## What's in the console

| Tab | Stage | What it shows |
|---|---|---|
| Candidates | MVP-0 | Readings, ranked candidates (relative score), evidence vs noise floor, weak-separation caveat, reveal card |
| Agent | MVP-1 | Tool-call trace, crew route on real pipes, simulated crew / manual reports, inspections used |
| Evaluation | MVP-1 | Top-1/top-3/hop error vs naive baseline, by noise/size/sensors, detection-gate stats |
| Sensors | S1 | Greedy vs farthest-point accuracy curve, proposed sensors on the map, "use these sensors" |
| Repairs | S2+S3 | Backlog of crew-confirmed leaks, knapsack repair plan within a PKR budget, payback |

Plus the one-page **investigation report** (S5): assembled only from tool outputs, printable to PDF.

## Honesty rules baked into the UI

- Truth is fetched only by **Reveal** (`GET /scenario/{id}/reveal`) and drawn in tracer violet only.
- Scores are labeled **relative score**, never probability or confidence.
- Every number carries a provenance tag: *measured*, *simulated*, *simulated estimate*, or *assumed*.
- Mock-mode numbers are badged **MOCK** everywhere, including the printed report.
- PKR values are **ASSUMPTIONS** (placeholders) until replaced with utility data.

## Notes for the backend team

The UI codes against `contracts/api.md` v1.1. Everything beyond the build-prompt contract is
optional and additive; the UI degrades gracefully without it. Worth a look:

1. **`POST /field/inspect`** (v1.1): simulated crew outcome so live demos don't need the presenter to know the truth.
2. **Abstain rule.** "Abstain if top1/top2 < 2" makes the agent refuse in most scenarios, because
   neighbouring junctions have near-identical signatures. The mock abstains only when the top two are
   nearly tied *and* ≥ 4 hops apart (a crew could go to the wrong district).
3. **Inspection order.** `plan_inspection` orders by nearest-from-depot, so the crew may visit lower-ranked
   nodes before the leader (seed 1000 needed 4 visits for a leak ranked #1 from the start). Consider ordering by
   score, or score-weighted distance.
4. Every response field the UI reads is typed in `frontend/src/contracts/types.ts`.

## Limitations (say them in the pitch)

Benchmark network stand-in (EPANET Net3), synthetic demand, junction-level localization, single leak,
steady-state snapshot. The mock engine is a qualitative surrogate for the WNTR backend, not physics.

## Backend handoff

The backend foundation is now included. See [backend/README.md](backend/README.md)
for setup and implementation status, [backend/docs/operations.md](backend/docs/operations.md)
for PostgreSQL, Redis and Docker instructions, and [backend/docs/validation.md](backend/docs/validation.md)
for actual test results.

The tested endpoints cover health/readiness, network topology, hidden-leak scenarios,
detection and explicit reveal. Investigation, evaluation, sensor placement and repair
optimization are in progress. The frontend and its offline mock engine are preserved.
Use the running backend OpenAPI (`/docs`) for available endpoints; frontend integration
shapes in `contracts/api.md` will be reconciled as the remaining modules are completed.
Credentials and device-specific environments are excluded from Git. Generate a local
`backend/.env` with `python scripts/init_env.py` from the backend directory.
