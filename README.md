# AquaTrace

Decision support for water utilities: infer a hidden leak's location from a handful of pressure
sensors, then run an investigator agent that plans a crew route, re-ranks after "nothing found here",
and says so honestly when the evidence is not enough.

```
aquatrace/
  contracts/api.md   # endpoint shapes — the source of truth (v1.1)
  mocks/*.json       # sample responses generated from the in-browser mock engine
  backend/           # FastAPI + WNTR (owned by the backend team)
  frontend/          # React 19 + Vite + TS + Tailwind v4 + deck.gl + react-three-fiber
  docs/              # UI/UX refinement plan
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

Open the app → 3-beat intro (→ to advance) → **Enter** → the camera dives into the console map.
For the pitch, press **F** for **Present mode**: full-screen map, chapter rail, captions and one big
number per step; the → key (or a clicker) drives the whole story. Pick a scenario first:

| Preset | Story |
|---|---|
| **Demo A** (seed 897) | Crew misses once, the agent re-ranks, the second visit finds it |
| **Demo B** (seed 101) | Small leak in high noise: honest no-call → add the recommended sensor → #1 |
| Random | One live, unscripted scenario (say so out loud) |

The **Next** chip on the map always offers the next step. Presenter shortcuts (press `?`):

`S` simulate · `D` detect · `A` add recommended sensor · `I` investigate · `C` send simulated crew ·
`V` reveal · `P` report · `R` reset map · `1–5` tabs · `F` Present mode · `T` projector theme ·
`M` sound cues (off by default)

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

**The map** (deck.gl, offline): terrain and contours computed from Net3 elevations, pipes drawn at
their real diameter, illustrative flow particles, and the **search cloud**: relative scores diffused
along the pipes, which visibly moves and collapses as crews report. The "search area" chip shows the
km of pipe still to walk. Without WebGL, or with `VITE_MAP_ENGINE=cytoscape`, the app falls back to
the 2D Cytoscape map automatically.

**Projector theme** (`T`): a high-contrast light theme for washed-out hall projectors; chart colours
validated for colour-blind readers on both themes.

Verified: 60 fps on integrated graphics (Intel UHD), full demo offline, with reduced motion, and with
WebGL disabled.

## Credits

Intro photo: Jacob Vathikulam, [Unsplash](https://unsplash.com/photos/a-large-pipe-is-coming-out-of-the-water-YzZuCdBQ4Jg)
(Unsplash License), re-encoded and duotoned. Everything else (terrain, icons, sounds) is generated.

## Honesty rules baked into the UI

- Truth is fetched only by **Reveal** (`GET /scenario/{id}/reveal`) and drawn in tracer violet only.
- Scores are labeled **relative score**, never probability or confidence.
- Every number carries a provenance tag: *measured*, *simulated*, *simulated estimate*, or *assumed*.
- Mock-mode numbers are badged **MOCK** everywhere, including the printed report.
- PKR values are **ASSUMPTIONS** (placeholders) until replaced with utility data.

## Notes for the backend team

## Presentation and system documentation

- [Presentation guide](docs/PRESENTATION_GUIDE.md) — problem, solution story, demo sequence, decisions, validation, and Q&A.
- [Complete system explanation](docs/SYSTEM_EXPLANATION.md) — architecture, end-to-end request flow, technical glossary, security boundaries, deployment, and roadmap.

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
