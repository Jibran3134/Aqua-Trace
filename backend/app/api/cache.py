"""Public DTO cache-aside; malformed cached shapes are never trusted."""
from pydantic import ValidationError


def cached_dto(runtime, model, bucket: str, parts: tuple, compute):
    """Validate hits and fresh results against the same public response DTO."""
    key = runtime.redis.cache_key(bucket, *parts)
    payload = runtime.redis.get_json(key)
    if payload is not None:
        try:
            return model.model_validate(payload)
        except ValidationError:
            runtime.redis.delete(key)
    result = model.model_validate(compute())
    runtime.redis.set_json(key, result.model_dump(mode="json", by_alias=True))
    return result
