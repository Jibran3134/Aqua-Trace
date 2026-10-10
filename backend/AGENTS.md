# Backend maintenance rules

The user's current request overrides the original plan's MVP shortcuts.
Implement backend only; authentication is intentionally excluded.

Read `docs/README.md`, `docs/contracts/api.md` and `docs/architecture.md` before edits.
Keep routes thin, validate HTTP/tool input with DTOs, and put calculations in services.
PostgreSQL is authoritative; Redis stores only disposable public cache/rate data.
Use Alembic migrations; never replace migrations with runtime `create_all`.
Ground truth lives in `aquatrace_private` and may reach HTTP only through reveal.
Never pass truth, full pressures, seeds, credentials or environment data to LLMs.
LLM tools are read-only. Field mutations require explicit crew API calls.
Do not log request bodies, truth, credentials or model content.
All reported numbers need simulated/measured/assumed provenance.
Do not claim tests passed without running them. Record actual failures and limitations.
Test and document a module before starting implementation of the next module.
