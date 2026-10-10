# Frontend response and event fixtures

The canonical HTTP DTOs are `app/schemas/api.py`; the endpoint summary is
`api.md`. Files in `backend/mocks/` are standalone JSON response bodies. They
are examples for frontend development, not API fallback behavior or evidence
of detector accuracy. No scenario seed, demand multiplier, complete pressure
snapshot or credential appears in these responses. Hidden-truth fields appear
only in `reveal.json`; public evaluation seed lists are separate benchmark inputs.

`network.json` contains every node and link from the supplied Net3 model.
Its coordinates are assumed schematic coordinates, not map coordinates.
Model link lengths and pipe routes are simulated infrastructure distances,
not driving distances. Pump connector lengths are assumed zero. The fixture's
default sensors are an illustrative selection, not the placement algorithm.
Other numerical examples are illustrative simulated outputs unless their
provenance explicitly identifies an economic or noise assumption. Never use
mock evaluation or placement numbers in a pitch as measured benchmark results.

## Endpoint fixtures

| Endpoint | Fixture | Frontend behavior |
|---|---|---|
| `GET /health` | `health.json`, `health-building.json` | Use `signatures_ready` and progress for the preparation banner. `status` describes service health. |
| `GET /ready` | `health.json` on success | HTTP 503 means a dependency or signatures are not ready; inspect `/health`. |
| `GET /network` | `network.json` | IDs are strings. Link endpoints use the JSON key `from`, not `from_node`. |
| `POST /scenario/leak` | `scenario-leak.json` | Save the returned UUID and sensor IDs. A `null` reading means offline. |
| `POST /detect` | `detect.json`, `detect-insufficient.json` | Render relative scores, estimated flow and evidence. Empty candidates are valid. |
| `POST /agent/step` | `agent-step.json`, `agent-abstained.json`, `agent-resolved.json` | Append the turn's events and use top-level state/recommendation fields for controls. |
| `POST /field/result` | `field-result.json`, `field-resolved.json` | Replace the ranking. Call the agent again to obtain the next turn or closing summary. |
| `GET /scenario/{id}/reveal` | `reveal.json` | This is the sole ground-truth response. Rank and hop error may be `null`. |
| `GET /eval` | `eval.json` | The illustrative fixture is marked `meta.mock=true`. Read the final evaluation DTO before binding metrics. |
| `POST /sensors/place` | `sensors-place.json` | Chart fractions `top1` and `top3` against `k`; show provenance. |
| `POST /repair/optimize` | `repair-optimize.json` | Show selected and greedy totals, defaulted costs, economic assumptions and the independence caveat. |
| Any error | `error.json`, `error-rate-limit.json`, `error-signatures.json` | Display `error.message` and `error.hint`; handle HTTP status separately. |

One sensor is accepted by scenario creation and placement. Detection then
returns `insufficient_evidence` when fewer than two live sensors remain.
Explicit `sensors` take precedence over `k`. Percentage formatting multiplies
score/accuracy fractions by 100; the backend stores fractions, not percentages.

The sample request for the main fixture sequence is:

```json
{"scenario_id":"a6710fae-56e1-4aec-89e4-b1c135afbe1b"}
```

For crew feedback, add `"node":"111"` and the JSON boolean `"found":false`
or `true`. The negative fixture keeps the inspected node's relative weight
above zero. Identical crew reports are idempotent; contradictory reports return
HTTP 409. A positive crew report closes the investigation without reading or
revealing the simulated truth. Authentication is excluded from this project.

## Agent timeline

Each `/agent/step` response contains one turn. Event shape:

```typescript
type EventType =
  | "thought" | "tool_call" | "tool_result"
  | "recommendation" | "abstain" | "final";

type AgentEvent = {
  step: number;
  type: EventType;
  name?: string | null;
  args?: Record<string, unknown> | null;
  result?: unknown | null;
  text?: string | null;
};
```

`thought` is a brief action status such as “Ranking candidates from sensor
residuals.” It is not private model reasoning. Render all text as plain text.
Optional fields can be omitted or `null`; do not assume every event has text,
arguments or a result. Steps identify events within a turn. When appending
turns, use a local turn identifier together with `step` as the component key.

| Event type | Rendering |
|---|---|
| `thought` | Short action status. |
| `tool_call` | Tool name and validated arguments. |
| `tool_result` | Collapsed structured payload with an expand control. Decode by `name`. |
| `recommendation` | Proposed inspection; use `recommended_node` and `route` from the response. |
| `abstain` | More evidence needed; highlight `recommended_sensor` when present. |
| `final` | Closed investigation summary assembled from public structured results. |

Top-level `source` is `llm` or `scripted`; use it for the badge. Both sources
share the same event envelope. `state` is `investigating`, `abstained` or
`resolved`. Recommendations can be absent or null, especially during abstention
and resolution. Empty event lists must be handled without a frontend exception.

## Read-only tool result shapes

| Tool | Arguments | Result |
|---|---|---|
| `rank_candidates` | `{top_k?:number}` | Detection response: `{status,candidates,evidence,note?,provenance}`. |
| `simulate_hypothesis` | `{node:string}` | `{node,per_sensor:[{sensor,observed,predicted}],rmse,fit_label,...}`. Observed and predicted values are pressure residuals in metres. |
| `plan_inspection` | `{nodes:string[],depot?:string}` | `{order:string[],total_length_m:number,legs:[{from,to,length_m,path:string[]}],...}`. |
| `recommend_sensor_addition` | `{}` | `{recommended:string|null,reason:string,...}`. |

Ellipses indicate descriptive/provenance fields permitted inside the current
`AgentEvent.result` payload, not extra fields on the strict HTTP envelope.
Tool results are read-only: `record_field_result` is not an LLM tool. Crew
mutations occur only through the explicit `/field/result` endpoint.

For route drawing, find the `plan_inspection` tool result. Draw each leg along
its `path` using positions from `/network`. The top-level `route` contains
inspection stop IDs, not every intermediate node. Joining only stop positions
would misrepresent the pipe path. The example route begins at depot `60`, visits
`111`, `103`, `101`, and has 18760.44 simulated metres of model link length.

The resolved fixture contains `inspections_used` and `total_length_m` in its
final result. These are illustrative public summary values. The frontend can
also count its acknowledged crew reports during a session; agent turns are not
inspections. Do not parse numerical statistics out of narrative text.

## Evaluation payload status

The current DTO declares `meta`, `results`, `baseline`, `by_noise`, `by_size`,
`by_k` and `gate` as dictionaries. The sample metric keys inside these objects
are illustrative placeholders pending the completed evaluation module and its
typed DTOs. Do not infer that the fixture's `n_scenarios`, `top1`, `top3`, or
`mean_hop_error_top1` keys are already a finalized runtime interface. Read the
generated OpenAPI and the updated contract when that module lands.

Only `reveal.json` identifies hidden truth for a scenario. Candidate IDs can
coincide with the hidden node without indicating which node is true. Node IDs
and numbers used by recommendations and summaries originate in tool results.
