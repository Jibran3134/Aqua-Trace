"""Environment configuration and explicit hydraulic assumptions."""

from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
# Net3 benchmark calibration (data/calibration.json); these labels are assumed,
# synthetic relative sizes, not utility hole-size classifications.
LEAK_AREAS_M2 = {"small": 0.006, "medium": 0.012, "large": 0.02}
NOISE_SIGMA_M = {"low": 0.05, "mid": 0.2, "high": 0.5}
DEMAND_MULT_RANGE = (0.9, 1.1)
DISCHARGE_COEFF = 0.75
REQUIRED_PRESSURE_M = 20.0
MINIMUM_PRESSURE_M = 0.0


class Settings(BaseSettings):
    """Validated settings; credentials and connection strings have redacted reprs."""

    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", extra="ignore",
        case_sensitive=False, hide_input_in_errors=True, allow_inf_nan=False,
    )

    environment: Literal["development", "test", "production"] = "development"
    database_url: SecretStr = SecretStr(
        "postgresql+psycopg://aquatrace:aquatrace@localhost:5432/aquatrace"
    )
    migration_database_url: SecretStr | None = None
    redis_url: SecretStr = SecretStr("redis://localhost:6379/0")
    database_pool_size: int = Field(default=5, ge=1, le=100)
    database_max_overflow: int = Field(default=5, ge=0, le=100)
    database_connect_timeout_s: int = Field(default=5, ge=1, le=60)
    redis_socket_timeout_s: float = Field(default=2.0, gt=0, le=30)
    cache_ttl_s: int = Field(default=300, ge=1, le=86400)
    cache_key_version: str = Field(default="v1", pattern=r"^[a-zA-Z0-9_-]{1,32}$")
    rate_limit_enabled: bool = True
    rate_limit_capacity: int = Field(default=60, ge=1, le=10000)
    rate_limit_refill_per_s: float = Field(default=1.0, gt=0, le=10000)
    expensive_rate_limit_capacity: int = Field(default=10, ge=1, le=10000)
    expensive_rate_limit_refill_per_s: float = Field(default=0.1, gt=0, le=10000)
    rate_limit_fail_closed: bool = True
    scenario_ttl_hours: int = Field(default=24, ge=1, le=8760)
    scenario_max_count: int = Field(default=200, ge=1, le=100000)
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])
    net_file: Path = BACKEND_DIR / "data" / "Net3.inp"
    cache_dir: Path = BACKEND_DIR / "cache"
    signature_auto_build: bool = True
    center_residuals: bool = False
    demand_projection: bool = True
    sensor_distance_metric: Literal["hops", "length"] = "hops"
    detector_tau: float = Field(default=0.05, gt=0)
    noise_floor_percentile: float = Field(default=95.0, gt=0, lt=100)
    default_sensors_k: int = Field(default=6, ge=1, le=10000)
    detector_top_k: int = Field(default=10, ge=1, le=100)
    sensor_dropout_rate: float = Field(default=0.0, ge=0, le=1)
    simulation_concurrency: int = Field(default=2, ge=1, le=32)
    max_agent_steps: int = Field(default=6, ge=1, le=12)
    llm_timeout_s: float = Field(default=8.0, gt=0, le=60)
    llm_enabled: bool = True
    demo_mode: bool = False
    llm_1_base_url: str = "https://generativelanguage.googleapis.com/v1beta/openai"
    llm_1_api_key: SecretStr = SecretStr("")
    llm_1_model: str = "gemini-3.8-flash"
    llm_2_base_url: str = "https://api.groq.com/openai/v1"
    llm_2_api_key: SecretStr = SecretStr("")
    llm_2_model: str = "llama-3.3-70b-versatile"
    max_request_bytes: int = Field(default=65536, ge=1024, le=1048576)
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    miss_prob: float = Field(default=0.05, gt=0, lt=1)

    @field_validator("database_url", "migration_database_url")
    @classmethod
    def postgres_url(cls, value: SecretStr | None) -> SecretStr | None:
        """Keep the application tied to PostgreSQL without disclosing URL values."""
        if value is not None:
            parsed = urlsplit(value.get_secret_value())
            if parsed.scheme not in {"postgresql", "postgresql+psycopg", "postgres"} or not parsed.hostname:
                raise ValueError("Use a PostgreSQL connection URL with a hostname.")
        return value

    @field_validator("redis_url")
    @classmethod
    def valid_redis_url(cls, value: SecretStr) -> SecretStr:
        parsed = urlsplit(value.get_secret_value())
        if parsed.scheme not in {"redis", "rediss"} or not parsed.hostname:
            raise ValueError("Use a redis:// or rediss:// connection URL with a hostname.")
        return value

    @field_validator("llm_1_base_url", "llm_2_base_url")
    @classmethod
    def provider_base_url(cls, value: str) -> str:
        parsed = urlsplit(value)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("Provider base URL must be an HTTP(S) URL without credentials.")
        if parsed.query or parsed.fragment:
            raise ValueError("Provider base URL cannot contain a query or fragment.")
        return value.rstrip("/")
