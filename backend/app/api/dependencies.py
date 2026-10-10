"""Resource lookup and quota enforcement shared across domain routers."""
from fastapi import Request, Response

from app.core.errors import DomainError


def enforce_rate_limit(request: Request, response: Response) -> None:
    """Use the peer address; forwarded headers are never trusted here."""
    if request.url.path in {"/health", "/ready", "/docs", "/openapi.json", "/redoc"}:
        return
    runtime = request.app.state.runtime
    expensive = request.url.path in {"/scenario/leak", "/agent/step", "/sensors/place"}
    # All heavy routes share a quota, preventing endpoint switching to bypass limits.
    bucket = "expensive" if expensive else "general"
    identity = request.client.host if request.client else "unknown"
    result = runtime.redis.rate_limit(identity, bucket, expensive=expensive)
    response.headers["X-RateLimit-Limit"] = str(result.limit)
    response.headers["X-RateLimit-Remaining"] = str(result.remaining)
    if not result.allowed:
        error = DomainError("rate_limit_exceeded", "Too many requests.",
                            "Wait for the Retry-After interval, then retry.", 429)
        error.retry_after = result.retry_after
        raise error
