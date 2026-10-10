# AquaTrace HTTP contract

Base URL: `http://localhost:8000`. Authentication is excluded. Interactive
OpenAPI: `/docs`; machine-readable schema: `/openapi.json`. Canonical DTOs:
`app/schemas/api.py`. Requests reject unknown fields, invalid node IDs, duplicate
sensors, nonfinite numbers and overlarge payloads. Scenario IDs are UUID strings.

All errors: `{"error":{"code":"...","message":"...","hint":"..."}}`.

| Method/path | Request | Response |
|---|---|---|
| GET `/health` | none | `{status,signatures_ready,signatures_progress,database,redis}` |
| GET `/network` | none | `{nodes:[{id,x,y,type}],pipes:[{id,from,to,length,type}],default_sensors,provenance}` |
| POST `/scenario/leak` | `{seed?,size?,noise?,sensors?,k?}` | `{scenario_id,sensors,readings,meta}` |
| POST `/detect` | `{scenario_id}` | `{status,candidates,evidence,note,provenance}` |
| POST `/agent/step` | `{scenario_id,mode?:auto\|scripted\|llm}` | `{events,source,recommended_node,route,state,recommended_sensor}` |
| POST `/field/result` | `{scenario_id,node,found:boolean}` | `{state,ranking:[{node,score}]}` |
| GET `/scenario/{id}/reveal` | none | `{true_leak_node,true_size,rank_of_truth,hop_error_top1,provenance}` |
| GET `/eval` | none | `{meta,results,baseline,by_noise,by_size,by_k,gate}` |
| POST `/sensors/place` | `{k:int}` | `{sensors,curve:[{k,top1,top3}],provenance}` |
| POST `/repair/optimize` | `{budget_pkr,candidates:[{node,est_leak_lps,repair_cost_pkr?}]}` | `{selected,greedy,budget_pkr,defaulted_cost_nodes,assumptions,note}` |

Size: `small|medium|large`; noise: `low|mid|high`; seed: unsigned 32-bit integer.
Leak sensor count: 1–12; placement count: 1–12. One live sensor causes abstention.
Explicit sensors take precedence
over `k` and must be unique junctions. Offline readings are `null`.

Candidate: `{node,score,adjacent_pipes,est_leak_lps,tie_group}`. Evidence:
`{residual_norm,noise_floor,margin_top1_vs_top2,live_sensors}`. Detection status:
`ok|insufficient_evidence`. Scores are relative fit weights. A candidate ID may
equal hidden truth; no field identifies which candidate is true before reveal.

Agent events: `{step,type,name?,args?,result?,text?}`; type is
`thought|tool_call|tool_result|recommendation|abstain|final`. Compatibility `thought`
events are short action statuses, not model reasoning. Agent state is
`investigating|resolved|abstained`. Crew reports never consult hidden truth.
Identical reports are idempotent; contradictory reports return 409.

Provenance fields label readings, detector results and benchmark evaluation
**simulated**. Noise, demand ranges and economic values are **assumed**.
Validation timings are **measured**. Pipe routes are simulated network paths,
not road routes. Mocks are examples, not field measurements.

404: unknown/expired scenario or missing evaluation. 409: conflicting/stale state.
413: body too large. 422: invalid input. 429: quota exhausted (`Retry-After`).
503: signatures building or infrastructure/simulation failure. Display message/hint.

Only reveal returns truth. Other responses and provider inputs omit seed, true
node/size, actual demand multiplier, effective area, true flow and noiseless full
pressures. State persists across restarts and expires after the configured TTL.
