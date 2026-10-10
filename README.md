# AquaTrace

Decision support for water utilities: infer a hidden leak's location from a handful of pressure
sensors, then run an investigator agent that plans a crew route and re-ranks after "nothing found here".

```
aquatrace/
  contracts/api.md   # endpoint shapes — the source of truth
  mocks/*.json       # sample responses generated from the in-browser mock engine
  backend/           # FastAPI + WNTR (owned by the backend team)
  frontend/          # React + Vite + TS + Tailwind + Cytoscape
```

## Run the frontend (3 commands)

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

By default the UI runs against the **in-browser mock engine** (`VITE_USE_MOCKS=true`), so the full
demo works offline. To use the real backend, create `frontend/.env.local`:

```
VITE_USE_MOCKS=false
VITE_API_URL=http://localhost:8000
```

## Honesty rules baked into the UI

- Truth is only shown after **Reveal** (`GET /scenario/{id}/reveal`).
- Scores are labeled **relative score**, never probability or confidence.
- Every number is labeled *measured*, *simulated*, or *assumed*.
- Mock-mode numbers are badged **MOCK** so they never end up on a slide by mistake.
