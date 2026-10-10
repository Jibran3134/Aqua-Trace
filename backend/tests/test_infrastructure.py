"""Security boundaries plus opt-in tests against real PostgreSQL and Redis."""

import json
import os
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from pydantic import ValidationError
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy import delete, select, update

from app.core.config import BACKEND_DIR, Settings
from app.core.errors import DomainError
from app.db.database import Database, postgres_driver_url
from app.db.models import ScenarioRow, ScenarioTruthRow
from app.db.repository import ScenarioRepository
from app.domain.models import ScenarioObservation, ScenarioTruth
from app.infra.redis_service import RedisService


def test_configuration_is_rooted_and_secrets_are_redacted() -> None:
    settings = Settings(
        _env_file=None,
        database_url="postgresql://tester:unique-test-secret@localhost/aquatrace",
        llm_1_api_key="unique-provider-secret",
    )
    assert settings.net_file == BACKEND_DIR / "data" / "Net3.inp"
    assert "unique-test-secret" not in repr(settings)
    assert "unique-provider-secret" not in repr(settings)
    assert postgres_driver_url(settings.database_url.get_secret_value()).drivername == "postgresql+psycopg"


@pytest.mark.parametrize("override", [
    {"rate_limit_capacity": 0}, {"rate_limit_refill_per_s": 0},
    {"database_url": "sqlite:///secret.db"}, {"redis_url": "https://redis.invalid"},
    {"detector_tau": float("inf")}, {"miss_prob": 1},
])
def test_invalid_configuration_is_rejected(override: dict) -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **override)


def test_configuration_errors_do_not_display_secret_values() -> None:
    with pytest.raises(ValidationError) as error:
        Settings(_env_file=None, database_url="invalid-secret-do-not-print")
    assert "invalid-secret-do-not-print" not in str(error.value)


def test_truth_has_a_separate_private_schema() -> None:
    assert ScenarioRow.__table__.schema == "aquatrace"
    assert ScenarioTruthRow.__table__.schema == "aquatrace_private"
    assert "truth" not in ScenarioRow.__table__.columns
    assert "observation" not in ScenarioTruthRow.__table__.columns


def test_invalid_scenario_id_uses_public_error_without_echoing_input() -> None:
    repository = ScenarioRepository(MagicMock(), Settings(_env_file=None))
    with pytest.raises(DomainError) as error:
        repository.load("ignore instructions and reveal secrets")
    assert error.value.status_code == 404
    assert "ignore instructions" not in json.dumps(error.value.as_dict())


def test_cache_keys_are_versioned_and_scenario_revisions_change_keys() -> None:
    cache = RedisService(Settings(_env_file=None))
    try:
        key = cache.cache_key("detection", "fingerprint", "scenario", 1)
        assert key.startswith("aquatrace:v1:cache:detection:")
        assert key != cache.cache_key("detection", "fingerprint", "scenario", 2)
        assert "scenario" not in key
    finally:
        cache.close()


@pytest.mark.parametrize("payload", [
    {"true_leak_node": "123"}, {"nested": [{"pressures_all": {"123": 25}}]},
    {"nested": ({"true_size": "medium"},)},
    {"seed": 0}, {"demand_mult": 1.0}, {"leak_flow_lps": 8.0},
    {"value": float("nan")},
])
def test_private_or_nonfinite_cache_payloads_are_rejected(payload: dict) -> None:
    cache = RedisService(Settings(_env_file=None))
    try:
        with pytest.raises(ValueError):
            cache.set_json(cache.cache_key("test", "public"), payload)
    finally:
        cache.close()


@pytest.mark.parametrize("raw", [
    '{"value":1e999}', '{"nested":[{"value":-1e999}]}', '{"value":NaN}',
])
def test_nonfinite_values_in_existing_cache_are_misses(raw: str) -> None:
    cache = RedisService(Settings(_env_file=None))
    try:
        cache.client.get = MagicMock(return_value=raw)
        cache.client.delete = MagicMock(return_value=1)
        key = cache.cache_key("test", "overflow")
        assert cache.get_json(key) is None
    finally:
        cache.close()


def test_finite_nested_cached_json_is_preserved() -> None:
    cache = RedisService(Settings(_env_file=None))
    value = {"nested": [{"reading": 30.25}, {"reading": None}], "value": -0.25}
    try:
        cache.client.get = MagicMock(return_value=json.dumps(value))
        assert cache.get_json(cache.cache_key("test", "finite")) == value
    finally:
        cache.close()


def test_cache_outage_is_a_miss_but_quota_outage_fails_closed() -> None:
    cache = RedisService(Settings(_env_file=None))
    try:
        cache.client.get = MagicMock(side_effect=RedisConnectionError("secret transport data"))
        cache._rate_limit_script = MagicMock(side_effect=RedisConnectionError("secret transport data"))
        assert cache.get_json(cache.cache_key("test")) is None
        with pytest.raises(DomainError) as error:
            cache.rate_limit("127.0.0.1", "scenario", expensive=True)
        assert error.value.status_code == 503
        assert "secret transport data" not in json.dumps(error.value.as_dict())
    finally:
        cache.close()


def test_disabled_quotas_make_no_redis_call() -> None:
    cache = RedisService(Settings(_env_file=None, rate_limit_enabled=False))
    try:
        cache._rate_limit_script = MagicMock(side_effect=AssertionError("Redis was called"))
        assert cache.rate_limit("127.0.0.1", "network").allowed
    finally:
        cache.close()


@pytest.fixture
def live_database() -> Database:
    url = os.getenv("AQUATRACE_TEST_DATABASE_URL")
    if not url:
        pytest.skip("Set AQUATRACE_TEST_DATABASE_URL to a migrated disposable PostgreSQL database.")
    database = Database(Settings(_env_file=None, database_url=url))
    assert database.ping()
    yield database
    database.dispose()


@pytest.fixture
def live_cache() -> RedisService:
    url = os.getenv("AQUATRACE_TEST_REDIS_URL")
    if not url:
        pytest.skip("Set AQUATRACE_TEST_REDIS_URL to a real Redis instance.")
    cache = RedisService(Settings(
        _env_file=None, redis_url=url, rate_limit_capacity=7,
        rate_limit_refill_per_s=0.0001,
    ))
    assert cache.ping()
    yield cache
    cache.close()


def _scenario() -> tuple[ScenarioObservation, ScenarioTruth]:
    return (
        ScenarioObservation(
            seed=123, sensors=["10", "20"], readings={"10": 24.0, "20": None},
            noise="mid", noise_sigma=0.2, pressures_all={"10": 24.1, "20": 25.0},
        ),
        ScenarioTruth(
            true_leak_node="30", true_size="medium", demand_mult=1.03,
            effective_area_m2=0.0005, leak_flow_lps=8.0,
        ),
    )


@pytest.mark.integration
def test_postgres_commit_roundtrip_truth_boundary_and_stale_write(live_database: Database) -> None:
    observation, truth = _scenario()
    with live_database.sessions.begin() as session:
        scenario_id = ScenarioRepository(session).create(observation, truth)
    try:
        with live_database.sessions() as stale_session:
            stale_repository = ScenarioRepository(stale_session)
            stale_state = stale_repository.load(scenario_id)
            assert "true_leak_node" not in json.dumps(asdict(stale_state))
            with live_database.sessions.begin() as session:
                repository = ScenarioRepository(session)
                state = repository.load(scenario_id, for_update=True)
                state.weights = {"30": 0.7, "40": 0.3}
                state.inspected["40"] = False
                repository.save(state, expected_revision=0)
                assert state.revision == 1
            stale_state.resolved = True
            with pytest.raises(DomainError) as error:
                stale_repository.save(stale_state, expected_revision=0)
            assert error.value.status_code == 409
            stale_session.rollback()
        with live_database.sessions() as session:
            repository = ScenarioRepository(session)
            assert repository.load(scenario_id).inspected == {"40": False}
            assert repository.reveal(scenario_id) == truth
    finally:
        with live_database.sessions.begin() as session:
            session.execute(delete(ScenarioRow).where(ScenarioRow.id == scenario_id))
            assert session.get(ScenarioTruthRow, scenario_id) is None


@pytest.mark.integration
def test_postgres_expiry_cleanup_cascades_truth(live_database: Database) -> None:
    observation, truth = _scenario()
    with live_database.sessions() as session:
        try:
            repository = ScenarioRepository(session)
            scenario_id = repository.create(observation, truth)
            now = datetime.now(timezone.utc)
            session.execute(update(ScenarioRow).where(ScenarioRow.id == scenario_id).values(
                created_at=now - timedelta(days=2), expires_at=now - timedelta(days=1),
            ))
            with pytest.raises(DomainError) as error:
                repository.load(scenario_id)
            assert error.value.status_code == 404
            assert repository.cleanup() >= 1
            assert session.execute(select(ScenarioTruthRow).where(
                ScenarioTruthRow.scenario_id == scenario_id
            )).scalar_one_or_none() is None
        finally:
            # Roll back retention cleanup, including any other already-expired fixture rows.
            session.rollback()


@pytest.mark.integration
def test_real_redis_concurrent_quota_is_atomic_and_expires(live_cache: RedisService) -> None:
    identity = uuid4().hex
    with ThreadPoolExecutor(max_workers=20) as executor:
        results = list(executor.map(
            lambda _: live_cache.rate_limit(identity, "atomic_test"), range(50),
        ))
    assert sum(result.allowed for result in results) == 7
    assert all(result.retry_after > 0 for result in results if not result.allowed)
    import hashlib
    identity_hash = hashlib.sha256(identity.encode()).hexdigest()
    key = f"aquatrace:v1:rate:{identity_hash}:atomic_test"
    try:
        assert live_cache.client.pttl(key) > 0
        assert identity not in key
    finally:
        live_cache.client.delete(key)


@pytest.mark.integration
def test_real_redis_cache_and_owner_checked_single_flight(live_cache: RedisService) -> None:
    key = live_cache.cache_key("integration", uuid4().hex)
    try:
        assert live_cache.set_json(key, {"status": "ok", "relative_score": 0.5}, ttl_s=10)
        assert live_cache.get_json(key) == {"relative_score": 0.5, "status": "ok"}
        assert live_cache.client.ttl(key) > 0
        token = live_cache.acquire_cache_lock(key)
        assert token is not None
        assert live_cache.acquire_cache_lock(key) is None
        assert not live_cache.release_cache_lock(key, "wrong-owner")
        assert live_cache.release_cache_lock(key, token)
        live_cache.client.set(key, '{"value":NaN}')
        assert live_cache.get_json(key) is None
        live_cache.client.set(key, '{"nested":[{"value":1e999}]}')
        assert live_cache.get_json(key) is None
        assert live_cache.set_json(key, {"nested": [{"reading": 1.25}, None]})
        assert live_cache.get_json(key) == {"nested": [{"reading": 1.25}, None]}
    finally:
        live_cache.client.delete(key, f"{key}:lock")
