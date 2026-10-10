# Investigation contract and provider boundary

`InvestigationTools` exposes four read-only tools: `rank_candidates`,
`simulate_hypothesis`, `plan_inspection`, and `recommend_sensor_addition`.
Strict DTOs reject coercion, unknown fields, nonfinite numbers, invalid IDs,
duplicate stops and oversized lists. Crew feedback is a separate
`record_field_result(state, node, found, miss_prob)` command, called only by the
transactional `/field/result` route. It never reads truth. Repeated identical
reports are idempotent; contradictions and new reports after closure return 409.
Negative reports retain a nonzero score. There is no arbitrary chat endpoint.

Both investigators use the same finite policy: rank three uninspected nodes;
abstain and recommend a sensor when evidence is insufficient or the leading score
ratio is below two; otherwise fit the leading hypothesis and plan an inspection.
A poor fit also abstains. Final prose is assembled from fixed templates and
validated tool results. Event `thought` text is an action status, not model reasoning.
Tools do not mutate the scenario snapshot. The route commits validated history
with a revision check, so a concurrent crew report rejects a stale turn.

Hypothesis outputs are `{node, alpha, per_sensor:[{sensor, observed, predicted}],
rmse, fit_label, provenance}`. Residuals and predictions use exactly
`Detector.fit_inputs`, including demand projection. Cached output must match the
requested node and ordered live sensors; malformed entries are recomputed.
Scores are relative fit scores. Signature-flow estimates and routes are simulated.
The route anchors the leading candidate first, then visits remaining stops by
nearest pipe distance. Legs include graph paths; these are not driving directions.
Sensor suggestions exclude current sensors and nonpositive baseline junctions.
Zero signature separation produces no suggestion. Adding a sensor requires a new
scenario with new simulated readings; existing scenarios are not silently changed.

The public agent result includes `route_length_m` and `inspections_used`. On abstention,
`recommended_node` is the suggested sensor, matching the frontend contract, with
the additive `recommended_sensor` alias. Resolved summaries use recorded crew
outcomes and the latest validated route event, never hidden truth. The frontend's
optional `/field/inspect` simulated-crew endpoint is not implemented: use explicit
manual `/field/result` reports. Truth is available only through `/scenario/{id}/reveal`.

Providers run Gemini first, then Groq, using a shared async HTTP pool. Missing keys,
disabled providers, unsafe responses or exhausted budgets fall back to scripted
mode in the API. Each provider receives a fresh temporary transcript containing
only fixed instructions and validated public tool outputs. No seed, complete
pressure field, private truth, raw history, credential or model narrative is sent.
Only one call is allowed per response, and its tool and arguments must match the
current policy step. One argument correction is permitted per provider; unknown
or mutating tools fail immediately. At most six rounds run per provider, with a
24-second total budget across both providers and configured socket timeouts.
Responses are streamed into a 128-KiB bound, transcripts into 256 KiB, arguments
into 8 KiB, and opaque signatures into 32 KiB. Duplicate JSON keys, excessive
nesting, NaN/infinity/overflow, redirects and compressed bodies are rejected.

Gemini 3 function calls carry an encrypted signature in
`tool_calls[].extra_content.google.thought_signature`. The original validated
argument string and signature are preserved exactly in that provider's temporary
call envelope. They never enter events, persistence, logs or the next provider.
Google requires returning signatures for sequential function calls; this is
protocol metadata, not user-visible reasoning.
[Google thought-signature documentation](https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures#openai).
HTTPX timeouts govern network inactivity; `asyncio.timeout` additionally bounds the
complete provider attempt sequence.
[HTTPX timeout documentation](https://www.python-httpx.org/advanced/timeouts/).

These controls limit available actions and data. Prompt wording alone is not a
security boundary. Remote model availability and compatibility require a separately
configured live check; the module's automated provider tests use `MockTransport`
and dummy keys, with no external request or claim of live-provider success.

Run `python scripts/test.py tests/test_investigation.py tests/test_investigation_tools.py -q`
for provider adversarial cases and real hydraulic tool checks. API transaction,
fallback and stale-turn behavior are covered in `tests/test_api_flow.py`.
