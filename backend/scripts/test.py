"""Run backend tests with optional private integration configuration."""

import argparse
import os
import sys
from pathlib import Path


def main() -> int:
    """Pass pytest arguments through without printing database or Redis secrets."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--integration", action="store_true",
        help="Enable real PostgreSQL/Redis fixtures using explicit test URLs or backend/.env.",
    )
    options, pytest_args = parser.parse_known_args()
    backend_dir = Path(__file__).resolve().parents[1]
    os.chdir(backend_dir)
    sys.path.insert(0, str(backend_dir))
    try:
        import pytest
    except ImportError:
        print("Install backend/requirements-dev.txt in the Python 3.13 virtual environment first.")
        return 2
    if options.integration:
        from pydantic import ValidationError

        from app.core.config import Settings

        try:
            settings = Settings()
        except ValidationError:
            print("Backend configuration is invalid; check backend/.env against .env.example.")
            return 2
        os.environ.setdefault("AQUATRACE_TEST_DATABASE_URL", settings.database_url.get_secret_value())
        os.environ.setdefault("AQUATRACE_TEST_REDIS_URL", settings.redis_url.get_secret_value())
    if pytest_args and pytest_args[0] == "--":
        pytest_args = pytest_args[1:]
    return int(pytest.main(pytest_args))


if __name__ == "__main__":
    raise SystemExit(main())
