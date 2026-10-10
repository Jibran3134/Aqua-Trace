"""Read secrets directly from settings rather than interpolating Alembic config."""

from logging.config import fileConfig

from sqlalchemy import create_engine, pool

from alembic import context
from app.core.config import Settings
from app.db.database import postgres_driver_url
from app.db.models import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)
settings = Settings()
secret_url = settings.migration_database_url or settings.database_url
database_url = postgres_driver_url(secret_url.get_secret_value())
target_metadata = Base.metadata


def include_name(name: str | None, type_: str, parent_names: dict) -> bool:
    """Never propose deleting Supabase-managed schemas or unrelated tables."""
    if type_ == "schema":
        return name in {"aquatrace", "aquatrace_private"}
    if type_ == "table":
        return parent_names.get("schema_qualified_table_name") in target_metadata.tables
    return True


def run_migrations_offline() -> None:
    context.configure(
        url=database_url, target_metadata=target_metadata, literal_binds=True,
        dialect_opts={"paramstyle": "named"}, include_schemas=True,
        include_name=include_name, compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = create_engine(
        database_url, poolclass=pool.NullPool, hide_parameters=True,
        connect_args={"connect_timeout": settings.database_connect_timeout_s, "prepare_threshold": None},
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata,
            include_schemas=True, include_name=include_name, compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()
    connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
