# Frontend integration decisions

The existing React frontend was merged from the team's remote `main` on
2026-10-10 without changing its code. Its types are in
`frontend/src/contracts/types.ts` and its shared contract is `contracts/api.md`.
The running backend OpenAPI and `app/schemas/api.py` define actual backend behavior.

Backend responses include additive provenance and operational fields. Integration
uses frontend names for required product fields: `health.progress` is a fraction,
`pipe.kind` identifies pumps/valves, and agent turns expose route length and
acknowledged inspection count. `signatures_progress` remains a percentage for
backend operational diagnostics. Both pipe `type` and `kind` describe the same link.

An abstained agent's `recommended_node` identifies a proposed sensor location.
`recommended_sensor` also identifies that sensor explicitly. In an investigating
turn, `recommended_node` instead identifies the proposed inspection stop. Use
`state` to interpret it. `route` contains stops; each `plan_inspection` result's
leg `path` contains all intermediate graph nodes for drawing.

No scenario seed is returned or sent to providers. The caller can retain its
chosen seed locally. Backend scenario IDs are UUID strings and persist through
restarts until their configured expiry. Sensors are limited to 1–12, covering
the UI's 3, 6 and 10 options and the placement curve. One live sensor is accepted
but detection abstains.

Use an explicit seed while comparing sensor sets in the current frontend. Its
random-scenario "add sensor and rerun" flow depends on an optional response seed;
without that value it creates a new hidden leak. Retaining the chosen seed in
frontend state would preserve comparisons without exposing private backend state.

The frontend's optional `/field/inspect` feature plays a simulated crew by reading
hidden truth. This backend keeps truth access in explicit reveal and uses
`/field/result` for crew reports. Use the frontend's manual report controls for
backend investigations. `record_field_result` is never an LLM tool.

Frontend mock results, demo seeds and benchmark values describe its qualitative
surrogate. They are not validation of WNTR physics. Recheck demo scenarios against
the real backend before presenting them. Public JSON examples in `backend/mocks/`
are also illustrative, not a substitute for the generated benchmark report.

Evaluation and repair response shapes are being aligned with the existing
frontend as their modules are implemented. Do not infer supported fields from
a draft example; consult OpenAPI and the module's tests.
