# AquaTrace API Contract (v1.1)

> **Source of truth.** Nobody codes against an endpoint that isn't in this file.
> Changes are announced in the group chat and recorded in the [Changelog](#changelog).
> Frontend types mirror this file 1:1 in `frontend/src/contracts/types.ts`.

## Conventions

| Rule | Detail |
|---|---|
| Base URL | `http://localhost:8000` (frontend reads `VITE_API_URL`) |
| CORS | `http://localhost:5173` allowed |
| Casing | `snake_case` JSON keys |
| Node / pipe IDs | Always **strings** (Net3 IDs are numeric-looking: `"10"`, `"River"`) |
| Units | pressure = metres of head (`m`), flow = litres per second (`lps`), length = metres (`m`), money = Pakistani rupees (`pkr`) |
| Time step | Single steady-state snapshot `"t0"` everywhere |
| Scores | **Relative scores** in `[0, 1]` that sum to ≈1 over all candidates. Never called probability or confidence |
| Truth | The true leak node appears **only** in `GET /scenario/{id}/reveal` |
| Nulls | `null` reading = sensor offline (UI shows "sensor offline") |

### Error format (every non-2xx)

```json
{ "error": { "code": "scenario_not_found", "message": "Scenario a1b2c3 does not exist.", "hint": "Scenario expired after a server restart; simulate again." } }
```

| HTTP | `code` | When |
|---|---|---|
| 404 | `scenario_not_found` | Unknown / expired `scenario_id` |
| 404 | `eval_missing` | `eval.json` not built (`hint`: "run python -m backend.evaluate") |
| 422 | `validation_error` | Bad body (unknown node, bad enum, k out of range) |
| 503 | `signatures_not_ready` | Signature library still building (`hint` includes progress) |
| 500 | `internal_error` | Anything else; never a raw stack trace |

---

## Endpoints

### `GET /health`
```json
{ "status": "ok", "signatures_ready": true, "progress": 1.0 }
```
`progress` (0–1) is optional; shown as a banner while `signatures_ready` is `false`.

### `GET /network`
```json
{
  "nodes": [ { "id": "10", "x": 9.0, "y": 27.85, "type": "junction" } ],
  "pipes": [ { "id": "101", "from": "10", "to": "101", "length": 14200, "kind": "pipe" } ],
  "default_sensors": ["10", "123", "209", "247", "60", "253"]
}
```
- `type`: `"junction" | "reservoir" | "tank"`
- `kind` (optional, default `"pipe"`): `"pipe" | "pump" | "valve"`. Pumps/valves have `length: 0`.
- Coordinates are raw `.inp` coordinates; the frontend normalizes them.

### `POST /scenario/leak`
Body (all optional):
```json
{ "seed": 1042, "size": "medium", "noise": "mid", "sensors": ["10","123"], "k": 6 }
```
- `size`: `"small" | "medium" | "large"` (random if omitted)
- `noise`: `"low" | "mid" | "high"` (default `"mid"`)
- `sensors` overrides `k`; otherwise `default_sensors(k)`; `k` default 6, range 1–20.

Response (**no truth**):
```json
{
  "scenario_id": "a1b2c3",
  "seed": 1042,
  "sensors": ["10","123","209","247","60","253"],
  "readings": { "10": 41.23, "123": null },
  "meta": { "time_step": "t0", "noise_sigma": 0.2, "noise_level": "mid", "demand_mult_known": false }
}
```

### `POST /detect`
Body: `{ "scenario_id": "a1b2c3" }`
```json
{
  "status": "ok",
  "candidates": [
    { "node": "211", "score": 0.41, "adjacent_pipes": ["211","213"], "est_leak_lps": 6.8, "tie_group": null }
  ],
  "evidence": { "residual_norm": 2.91, "noise_floor": 0.84, "margin_top1_vs_top2": 1.9, "live_sensors": 6 },
  "note": null,
  "recommended_sensor": null
}
```
- `status`: `"ok" | "insufficient_evidence"`
- `candidates`: top 10, sorted by score desc. Uses the current posterior (after field feedback).
- `tie_group`: integer shared by candidates whose scores are within 1%, else `null`.
- `margin_top1_vs_top2`: score ratio top1/top2.
- `note`: human-readable reason when `insufficient_evidence` (e.g. "residual below noise floor", "no live sensors").
- `recommended_sensor` (optional): node where adding a sensor best separates the top two candidates.

### `POST /agent/step`
Body: `{ "scenario_id": "a1b2c3", "mode": "auto" }` (`mode`: `"auto" | "scripted" | "llm"`)
```json
{
  "events": [
    { "step": 1, "type": "thought", "text": "Ranking candidates from sensor residuals." },
    { "step": 1, "type": "tool_call", "name": "rank_candidates", "args": { "top_k": 3 } },
    { "step": 1, "type": "tool_result", "name": "rank_candidates", "result": { "candidates": [] } },
    { "step": 4, "type": "recommendation", "text": "Inspect node 211 first (route: 211 → 213 → 209)." }
  ],
  "source": "scripted",
  "recommended_node": "211",
  "route": ["211","213","209"],
  "route_length_m": 1840,
  "inspections_used": 0,
  "state": "investigating"
}
```
- `type`: `"thought" | "tool_call" | "tool_result" | "recommendation" | "abstain" | "final"`
- `source`: `"llm" | "scripted"`
- `state`: `"investigating" | "resolved" | "abstained"`
- `route`: inspection **order** (node IDs). The frontend draws it along graph shortest paths.
- On `abstain`, `recommended_node` is the **sensor** recommendation.
- Tool names: `rank_candidates`, `simulate_hypothesis`, `plan_inspection`, `record_field_result`, `recommend_sensor_addition`.

### `POST /field/result`
Body: `{ "scenario_id": "a1b2c3", "node": "211", "found": false }`
```json
{ "state": "investigating", "ranking": [ { "node": "213", "score": 0.47 } ], "note": null }
```
Idempotent: repeating a report changes nothing. `found: false` down-weights (never zeroes) the node.

### `POST /field/inspect` (v1.1: simulated crew)
Body: `{ "scenario_id": "a1b2c3", "node": "211" }`

The server plays the field crew: it checks the node against the hidden truth, applies
`MISS_PROB` (a crew can miss a real leak), **records the outcome exactly like `/field/result`**,
and returns what the crew reported. Lets a live demo run without the presenter knowing the truth.
```json
{ "node": "211", "found": false, "state": "investigating", "ranking": [ { "node": "213", "score": 0.47 } ], "note": null }
```
- Deterministic: same scenario + node gives the same outcome (seed it from scenario seed + node id).
- Reveals nothing beyond what a real crew learns (leak / no leak **at that node**). Never returns the true node.
- Same validation and idempotency as `/field/result`.

### `GET /scenario/{id}/reveal`
```json
{ "true_leak_node": "213", "true_size": "medium", "rank_of_truth": 2, "hop_error_top1": 1 }
```

### `GET /eval`
```json
{
  "meta": { "seeds": 100, "k": 6, "tau": 0.35, "time_step": "t0", "network": "Net3",
            "note": "demand multiplier ±10%, sensor noise, synthetic scenarios", "generated_at": "2026-10-10T12:00:00Z" },
  "results":  { "n": 100, "top1": 0.42, "top3": 0.74, "mean_hop_error": 1.3, "insufficient": 0.06, "skipped": 0 },
  "baseline": { "n": 100, "top1": 0.14, "top3": 0.31, "mean_hop_error": 3.8, "insufficient": 0.0, "skipped": 0 },
  "by_noise": { "low": Metrics, "mid": Metrics, "high": Metrics },
  "by_size":  { "small": Metrics, "medium": Metrics, "large": Metrics },
  "by_k":     { "3": Metrics, "6": Metrics, "10": Metrics },
  "gate":     { "no_leak_flagged": 0.93, "small_leak_flagged": 0.22 }
}
```
`Metrics = { n, top1, top3, mean_hop_error, insufficient, skipped }` (rates in `[0,1]`).
`by_noise` / `by_size` / `by_k` each hold `Metrics` for the method and optionally `baseline_top3`.

### `POST /sensors/place` (stretch S1)
Body: `{ "k": 6, "noise": "mid" }`
```json
{ "sensors": ["10","123"], "curve": [ { "k": 1, "top1": 0.05, "top3": 0.12, "baseline_top3": 0.09 } ] }
```
`curve` covers k = 1..12. `baseline_top3` (optional) = farthest-point sampling at equal k.

### `POST /repair/optimize` (stretch S2 + S3)
Body:
```json
{ "budget_pkr": 500000, "value_per_litre_pkr": 0.05,
  "candidates": [ { "node": "211", "est_leak_lps": 6.8, "repair_cost_pkr": 180000 } ] }
```
`repair_cost_pkr` optional (default used and flagged). `value_per_litre_pkr` optional (assumption default).
```json
{
  "selected": [ { "node": "211", "est_leak_lps": 6.8, "repair_cost_pkr": 180000, "litres_per_day": 587520, "cost_defaulted": false } ],
  "total_cost_pkr": 180000,
  "litres_per_day_saved": 587520,
  "value_pkr_per_day": 29376,
  "payback_days": 6.1,
  "greedy": { "selected": ["211"], "total_cost_pkr": 180000, "litres_per_day_saved": 587520 },
  "assumptions": { "value_per_litre_pkr": 0.05, "default_repair_cost_pkr": 150000,
                   "label": "ASSUMPTION: replace with utility data" },
  "note": "assumes independent leaks"
}
```
`litres_per_day = est_leak_lps × 86400`. Solved as 0/1 knapsack (DP); `greedy` returned for comparison.

---

## Provenance labels (UI rule: every number is labeled)

| Field | Label |
|---|---|
| `readings` | measured (simulated sensor in this MVP → shown as "simulated reading") |
| `score` | relative score |
| `est_leak_lps`, `litres_per_day` | simulated estimate |
| `residual_norm`, `noise_floor` | simulated |
| eval metrics | simulated (synthetic scenarios) |
| `value_per_litre_pkr`, repair costs | assumed |

## Changelog

| Version | Change | Owner |
|---|---|---|
| 1.1 | **New endpoint** `POST /field/inspect` (simulated crew outcome, recorded like `/field/result`). Additive; nothing else changes. | P3 |
| 1.0 | Initial contract from build prompts §3. Added (all **optional/additive**): `health.progress`, `pipe.kind`, `scenario.seed` + `meta.noise_level`, `candidate.tie_group`, `evidence.live_sensors`, `detect.recommended_sensor`, `agent.route_length_m` + `inspections_used`, `field.note`, concrete `/eval` and `/repair/optimize` shapes, `curve.baseline_top3`. | P3 |
