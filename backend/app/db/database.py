"""Database engine and short-lived transaction/session factories."""

from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.orm import sessionmaker

from app.core.config import Settings


def postgres_driver_url(value: str) -> URL:
    """Select Psycopg 3 for ordinary and SQLAlchemy PostgreSQL URLs."""
    return make_url(value).set(drivername="postgresql+psycopg")


class Database:
    """Own one bounded engine pool; never share a Session across requests."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.engine = create_engine(
            postgres_driver_url(settings.database_url.get_secret_value()),
            pool_size=settings.database_pool_size,
            max_overflow=settings.database_max_overflow,
            pool_pre_ping=True, pool_recycle=300,
            pool_timeout=settings.database_connect_timeout_s,
            hide_parameters=True,
            connect_args={
                "connect_timeout": settings.database_connect_timeout_s,
                "prepare_threshold": None,
            },
        )
        self.sessions = sessionmaker(
            bind=self.engine, autoflush=False, expire_on_commit=False,
            info={"settings": settings},
        )

    def ping(self) -> bool:
        """Verify connectivity without creating or modifying any schema."""
        with self.engine.connect() as connection:
            return connection.execute(text("SELECT 1")).scalar_one() == 1

    def dispose(self) -> None:
        self.engine.dispose()
