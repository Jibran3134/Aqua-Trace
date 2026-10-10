"""Atomic Redis rate limits and finite, versioned JSON cache values."""

import hashlib
import json
import logging
import math
import re
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

from redis import Redis
from redis.exceptions import RedisError

from app.core.config import Settings
from app.core.errors import DomainError

logger = logging.getLogger(__name__)
_BUCKET_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")
_PRIVATE_CACHE_FIELDS = {
    "true_leak_node", "true_size", "pressures_all", "effective_area_m2",
    "demand_mult", "leak_flow_lps", "seed",
}

TOKEN_BUCKET_LUA = """
local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local clock = redis.call('TIME')
local now = tonumber(clock[1]) + tonumber(clock[2]) / 1000000
local previous = redis.call('HMGET', KEYS[1], 'tokens', 'updated_at')
local tokens = tonumber(previous[1]) or capacity
local updated_at = tonumber(previous[2]) or now
tokens = math.min(capacity, tokens + math.max(0, now - updated_at) * refill_rate)
local allowed = 0
local retry_after = 0
if tokens >= 1 then
    tokens = tokens - 1
    allowed = 1
else
    retry_after = math.ceil((1 - tokens) / refill_rate)
end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'updated_at', now)
redis.call('PEXPIRE', KEYS[1], math.ceil(capacity / refill_rate * 1000) + 1000)
return {allowed, math.floor(tokens), retry_after, capacity}
"""

RELEASE_LOCK_LUA = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
end
return 0
"""


@dataclass(frozen=True)
class RateLimitResult:
    allowed: bool
    remaining: int
    retry_after: int
    limit: int


def _contains_private_fields(value: Any) -> bool:
    if isinstance(value, dict):
        return bool(_PRIVATE_CACHE_FIELDS.intersection(value)) or any(
            _contains_private_fields(item) for item in value.values()
        )
    if isinstance(value, (list, tuple)):
        return any(_contains_private_fields(item) for item in value)
    return False


def _reject_nonfinite(value: str) -> None:
    raise ValueError("Cache JSON cannot contain nonfinite numbers.")


def _contains_nonfinite(value: Any) -> bool:
    """JSON exponent overflow can produce infinity without NaN/Infinity tokens."""
    if isinstance(value, float):
        return not math.isfinite(value)
    if isinstance(value, dict):
        return any(_contains_nonfinite(item) for item in value.values())
    if isinstance(value, (list, tuple)):
        return any(_contains_nonfinite(item) for item in value)
    return False


class RedisService:
    """Cache failure degrades to a miss; quotas fail closed unless configured."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.client = Redis.from_url(
            settings.redis_url.get_secret_value(), decode_responses=True,
            socket_timeout=settings.redis_socket_timeout_s,
            socket_connect_timeout=settings.redis_socket_timeout_s,
            health_check_interval=30,
        )
        self._rate_limit_script = self.client.register_script(TOKEN_BUCKET_LUA)
        self._release_lock_script = self.client.register_script(RELEASE_LOCK_LUA)

    def ping(self) -> bool:
        return bool(self.client.ping())

    def close(self) -> None:
        self.client.close()

    def cache_key(self, bucket: str, *parts: Any) -> str:
        """Version serialized values and hash key inputs to avoid sensitive key text."""
        if not _BUCKET_PATTERN.fullmatch(bucket):
            raise ValueError("Cache bucket must be a bounded alphanumeric identifier.")
        encoded = json.dumps(parts, sort_keys=True, separators=(",", ":"), allow_nan=False)
        digest = hashlib.sha256(encoded.encode("utf-8")).hexdigest()
        return f"aquatrace:{self.settings.cache_key_version}:cache:{bucket}:{digest}"

    def get_json(self, key: str) -> Any | None:
        try:
            raw = self.client.get(key)
            if raw is None:
                return None
            value = json.loads(raw, parse_constant=_reject_nonfinite)
            if _contains_private_fields(value) or _contains_nonfinite(value):
                self.client.delete(key)
                return None
            return value
        except (RedisError, ValueError, TypeError):
            logger.warning("Redis cache read unavailable or invalid; treating as a miss.")
            return None

    def set_json(self, key: str, value: Any, ttl_s: int | None = None) -> bool:
        """Cache public data only; truth and complete pressure snapshots are rejected."""
        if _contains_private_fields(value):
            raise ValueError("Private scenario fields cannot be stored in the public cache.")
        raw = json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)
        ttl = self.settings.cache_ttl_s if ttl_s is None else ttl_s
        if ttl < 1:
            raise ValueError("Cache TTL must be positive.")
        try:
            return bool(self.client.set(key, raw, ex=ttl))
        except RedisError:
            logger.warning("Redis cache write unavailable; continuing without cache.")
            return False

    def delete(self, key: str) -> bool:
        try:
            return bool(self.client.delete(key))
        except RedisError:
            logger.warning("Redis cache invalidation unavailable.")
            return False

    def acquire_cache_lock(self, key: str, ttl_s: int = 30) -> str | None:
        """Best-effort single-flight lock; never use this for database correctness."""
        if not 1 <= ttl_s <= 300:
            raise ValueError("Cache lock TTL must be between 1 and 300 seconds.")
        token = uuid4().hex
        try:
            if self.client.set(f"{key}:lock", token, nx=True, ex=ttl_s):
                return token
        except RedisError:
            logger.warning("Redis cache loading lock unavailable.")
        return None

    def release_cache_lock(self, key: str, token: str) -> bool:
        """Release only the exact lock this caller acquired, even after lease expiry."""
        try:
            return bool(self._release_lock_script(keys=[f"{key}:lock"], args=[token]))
        except RedisError:
            logger.warning("Redis cache loading lock release unavailable.")
            return False

    def rate_limit(self, client_id: str, bucket: str, expensive: bool = False) -> RateLimitResult:
        """Use Redis server time and one atomic script across every API replica."""
        if not _BUCKET_PATTERN.fullmatch(bucket):
            raise ValueError("Rate limit bucket must be a bounded alphanumeric identifier.")
        capacity = (
            self.settings.expensive_rate_limit_capacity if expensive
            else self.settings.rate_limit_capacity
        )
        refill = (
            self.settings.expensive_rate_limit_refill_per_s if expensive
            else self.settings.rate_limit_refill_per_s
        )
        if not self.settings.rate_limit_enabled:
            return RateLimitResult(True, capacity, 0, capacity)
        identity = hashlib.sha256(client_id.encode("utf-8")).hexdigest()
        key = f"aquatrace:{self.settings.cache_key_version}:rate:{identity}:{bucket}"
        try:
            result = self._rate_limit_script(keys=[key], args=[capacity, refill])
            return RateLimitResult(bool(result[0]), int(result[1]), int(result[2]), int(result[3]))
        except RedisError as exc:
            if self.settings.rate_limit_fail_closed:
                raise DomainError(
                    "rate_limit_unavailable", "Request protection is temporarily unavailable.",
                    "Wait briefly and try again.", 503,
                ) from exc
            logger.warning("Redis request quotas unavailable; configured fail-open mode is active.")
            return RateLimitResult(True, capacity, 0, capacity)
