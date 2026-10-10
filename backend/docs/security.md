# Security boundaries

Authentication and multi-tenancy are explicitly outside this backend's scope.
The supplied Compose configuration binds services to localhost. An application
caller can create, inspect, report on and reveal scenarios; there is no user
ownership check. CORS only controls browser access and does not authenticate a
caller. Deployment access belongs at the network boundary until an authentication
module is explicitly requested.

## HTTP input

Canonical request DTOs are in `app/schemas/api.py`. Reject unexpected fields,
nonfinite numbers, malformed scenario IDs, invalid node identifiers, duplicate
sensors and unsupported enum values. A syntactically valid node must also exist
in the loaded network. The application bounds request bodies, including streamed
bodies, with `MAX_REQUEST_BYTES`. Crew `found` values are strict booleans.

SQLAlchemy builds parameterized queries. Request input must never become SQL,
Python expressions, shell commands, provider URLs or dynamic callable names.
Public errors contain only `code`, `message` and a recovery `hint`; raw request
bodies, transport failures and internal tracebacks are not response content.

## Hidden truth

`aquatrace.scenarios` stores internal observations and investigation state.
`aquatrace_private.scenario_truth` stores truth in a separate table. Alembic
revokes PUBLIC access to the private schema/table. Runtime scenario loads do not
join truth; only explicit reveal and offline evaluation may read it.

Observation state contains the RNG seed and complete noise-free pressures for
offline evaluation. These are internal too. HTTP projections and provider inputs
must omit seed, true node/size, actual demand multiplier, effective area, true leak
flow and full pressures. A candidate ID may coincide with truth without identifying
which candidate is true. Tests should inspect structured fields, not ban an ID's
appearance among legitimate candidates.

## LLM execution contract

The investigator accepts scenario IDs and a supported mode, rather than arbitrary
chat prompts. Tools are read-only, bounded domain functions. In particular, the
model cannot call `record_field_result`: inspection outcomes require explicit
crew HTTP input. The model has no SQL, filesystem, environment, shell or network
tool. Provider URLs and credentials come from deployment settings only.

Validate each proposed tool name against a fixed allowlist and each argument
object against a strict DTO. Enforce valid candidate membership and the permitted
investigation sequence in application code. Rank first; insufficient evidence
requires a sensor recommendation and abstention. Hypothesis checks and route
planning use validated ranking outputs. Bound tool calls, argument sizes and
provider timeouts; do not let parallel tool requests bypass the step budget.

Provider messages contain sanitized observation/tool JSON, never hidden truth,
seed, complete pressures or credentials. Invalid arguments must not be echoed
verbatim into subsequent model context. Model text is untrusted; structured
recommendations, IDs, scores and route lengths come from domain tool outputs.
Compatibility `thought` events contain brief action statuses, not model reasoning.
Use deterministic public templates when narrative validation fails. Malformed
responses, unavailable providers or exhausted step budgets use scripted fallback.

These are execution boundaries, not a claim that prompt filtering eliminates
injection. Test unknown tools, mutation attempts, fake IDs, extra arguments,
oversized JSON, unsafe text and indirect instructions in tool data. See
[OWASP's guidance](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html).

## Redis and concurrency

Redis server time and one atomic Lua script govern token consumption across
replicas. Identity comes from the socket client address, hashed in keys. Forwarded
headers must not choose client identity; only an explicitly trusted reverse proxy
may supply effective client addresses. Expensive routes have separate quotas.
Exhaustion produces 429 and `Retry-After`; an unavailable enabled limiter produces
503 by default. `RATE_LIMIT_FAIL_CLOSED=false` is an explicit fail-open override.

Public JSON cache keys include a format version and hashed computation inputs;
scenario-dependent keys also include revision and computation fingerprint. Cache
read failures become misses and write failures allow the request to continue.
Nonfinite JSON and known private field names are rejected. Cache locks prevent
duplicate loading only; an owner token is required for release. PostgreSQL row
locks and revision checks protect durable state. External provider calls must not
hold database locks. A concurrent crew change makes an old snapshot retryable
with 409, and identical field reports must not apply a second weight reduction.

## Secrets and evidence

Connection URLs and API keys use Pydantic `SecretStr`. Settings validation hides
input values; SQLAlchemy parameter logging is disabled. Do not log request bodies,
private truth, provider message content or raw credentials. `scripts/test.py`
loads test URLs into its process environment without printing them. Test output
and measured acceptance results belong in `docs/validation.md`; skipped or
unexecuted tests are not passing tests.
