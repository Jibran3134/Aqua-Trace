# Verified references (2026-10-10)

- WNTR/Python: https://usepa.github.io/WNTR/installation.html
- Tagged Net3: https://raw.githubusercontent.com/USEPA/WNTR/1.5.0/examples/networks/Net3.inp
- Simulator: https://usepa.github.io/WNTR/apidoc/wntr.sim.core.WNTRSimulator.html
- Units: https://usepa.github.io/WNTR/units.html
- FastAPI: https://fastapi.tiangolo.com/tutorial/bigger-applications/
- Lifespan: https://fastapi.tiangolo.com/advanced/events/
- Psycopg: https://docs.sqlalchemy.org/en/20/dialects/postgresql.html
- Alembic: https://alembic.sqlalchemy.org/en/latest/tutorial.html
- Redis: https://redis.io/docs/latest/develop/use-cases/rate-limiter/
- Supabase: https://supabase.com/docs/guides/database/connecting-to-postgres
- Groq: https://console.groq.com/docs/tool-use/local-tool-calling
- Gemini: https://ai.google.dev/gemini-api/docs/openai
- Model lifecycle: https://ai.google.dev/gemini-api/docs/deprecations
- Injection: https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html

Verified choices: Python 3.13, WNTR 1.5.0, `wn.to_graph()`, duration zero,
`add_leak`, `run_sim(convergence_error=True)`, hydraulic demand multiplier.
Leak demand needs ×1000 for L/s. `base_demand` is read-only. Explicit PDD required
pressure avoids the library's tiny default. Retry records actual effective area.

Supabase persistent backends use direct/session pooling. Transaction pooling
does not support prepared statements; these are disabled for portability.
Softmax temperature changes sharpness, not ranking. Noise-floor cache identity
includes live sensor IDs. Truth privacy tests inspect fields, not node substrings.

The current official Gemini compatibility examples use `gemini-3.8-flash`.
The lifecycle page restricts legacy 2.5 models to existing users, so new projects
default to 3.8 Flash. Models remain configurable; credentials are not included.
