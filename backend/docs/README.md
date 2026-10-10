# Backend knowledge index

Read these sources before changing code. The user requested a complete backend,
PostgreSQL, Redis, Docker and no authentication, overriding the attached plan's
four-hour MVP restrictions. No frontend is implemented here.

- `contracts/api.md`: HTTP source of truth, errors, provenance and frontend examples.
- `architecture.md`: dependency boundaries, truth isolation and persistence.
- `research.md`: verified library APIs and official references.
- `security.md`: input and LLM boundaries, rate limits and trust model.
- `operations.md`: setup, configuration, backups and failure recovery.
- `supabase-migration.md`: portable schemas and migration procedure.
- `validation.md`: commands and measured acceptance results.
- `hydraulics.md`: calibrated assumptions, physics and limitations.
- `detection.md`: inference choices, validation diagnostics and abstention.
- `frontend-integration.md`: compatibility with the merged frontend and deliberate boundaries.

Never invent project facts, metrics, table names or endpoints. Read the code and
generated OpenAPI schema; run the relevant tests. Update the contract and these
documents when behavior changes. Synthetic benchmark results are not field data.
