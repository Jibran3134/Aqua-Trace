"""FastAPI composition root; application lifespan owns all runtime resources."""
import asyncio
import logging
from contextlib import asynccontextmanager
from threading import Thread
from types import SimpleNamespace

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from sqlalchemy.exc import SQLAlchemyError
from starlette.exceptions import HTTPException
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse

from app.api.cache import cached_dto
from app.api.dependencies import enforce_rate_limit
from app.api.detection import router as detection_router
from app.api.middleware import BodyLimitMiddleware, SafeErrorMiddleware
from app.api.scenarios import router as scenarios_router
from app.core.config import Settings
from app.core.errors import DomainError
from app.db.database import Database
from app.detection.scenarios import ScenarioGenerator
from app.detection.service import Detector
from app.hydraulics.service import HydraulicService
from app.hydraulics.signatures import SignatureLibrary, SignaturesNotReady
from app.infra.redis_service import RedisService
from app.schemas.api import HealthResponse, NetworkResponse

logger = logging.getLogger("aquatrace")


def create_app(settings: Settings | None = None) -> FastAPI:
    """Construct an isolated application, allowing controlled settings in tests."""
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        database = Database(settings)
        redis = RedisService(settings)
        app.state.runtime = SimpleNamespace(settings=settings, database=database, redis=redis)
        app.state.runtime.hydraulics = HydraulicService(settings)
        signatures = SignatureLibrary(settings, app.state.runtime.hydraulics)
        app.state.runtime.signatures = signatures
        app.state.runtime.generator = ScenarioGenerator(
            settings, app.state.runtime.hydraulics, signatures)
        app.state.runtime.detector = Detector(settings, app.state.runtime.hydraulics,
                                              signatures, app.state.runtime.generator, redis)
        builder = None
        try:
            signatures.load()
        except SignaturesNotReady:
            if settings.signature_auto_build:
                def build_signatures():
                    try:
                        signatures.build()
                    except Exception as error:
                        logger.error("Signature build failed (%s).", type(error).__name__)
                builder = Thread(target=build_signatures, name="signature-builder", daemon=True)
                builder.start()
        try:
            yield
        finally:
            if builder is not None:
                await asyncio.to_thread(builder.join, 2)
            redis.close()
            database.dispose()

    app = FastAPI(title="AquaTrace Backend", version="0.1.0", lifespan=lifespan,
                  dependencies=[Depends(enforce_rate_limit)])
    app.add_middleware(BodyLimitMiddleware, max_bytes=settings.max_request_bytes)
    app.add_middleware(SafeErrorMiddleware)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins,
                       allow_credentials=False, allow_methods=["GET", "POST"],
                       allow_headers=["Content-Type"],
                       expose_headers=["Retry-After", "X-RateLimit-Limit", "X-RateLimit-Remaining"])

    @app.exception_handler(DomainError)
    async def domain_error(request: Request, error: DomainError):
        headers = {}
        if error.status_code == 429:
            headers["Retry-After"] = str(getattr(error, "retry_after", 1))
        return JSONResponse(error.as_dict(), status_code=error.status_code, headers=headers)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, error: RequestValidationError):
        return JSONResponse({"error": {
            "code": "validation_error", "message": "Request fields do not match the API contract.",
            "hint": "Check field types, limits and allowed values in /docs.",
        }}, status_code=422)

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, error: HTTPException):
        return JSONResponse({"error": {
            "code": "http_error", "message": "The requested resource or method is unavailable.",
            "hint": "Check the documented endpoint and HTTP method.",
        }}, status_code=error.status_code)

    @app.exception_handler(SQLAlchemyError)
    async def database_error(request: Request, error: SQLAlchemyError):
        logger.warning("Database operation failed (%s).", type(error).__name__)
        return JSONResponse({"error": {
            "code": "database_unavailable", "message": "The database is temporarily unavailable.",
            "hint": "Check PostgreSQL readiness and applied migrations, then retry.",
        }}, status_code=503)

    @app.exception_handler(Exception)
    async def internal_error(request: Request, error: Exception):
        # Exception reprs/tracebacks can contain SQL parameters, provider text or secrets.
        logger.error("Request failed (%s).", type(error).__name__)
        return JSONResponse({"error": {
            "code": "internal_error", "message": "The operation could not be completed.",
            "hint": "Retry once; if it persists, check backend service health.",
        }}, status_code=500)

    @app.get("/health", response_model=HealthResponse, tags=["operations"])
    def health(request: Request):
        runtime = request.app.state.runtime
        def healthy(resource):
            try:
                return "ok" if resource.ping() else "unavailable"
            except Exception:
                return "unavailable"
        db_status, redis_status = healthy(runtime.database), healthy(runtime.redis)
        signature_state = runtime.signatures.get_state()
        return HealthResponse(status="ok" if db_status == redis_status == "ok" else "degraded",
                              signatures_ready=signature_state["ready"],
                              signatures_progress=signature_state["progress"],
                              database=db_status, redis=redis_status)

    @app.get("/ready", response_model=HealthResponse, tags=["operations"])
    def ready(request: Request):
        result = health(request)
        if result.status != "ok" or not result.signatures_ready:
            raise DomainError("not_ready", "The backend is preparing or a dependency is unavailable.",
                              "Check /health and retry when signatures and services are ready.", 503)
        return result

    @app.get("/network", response_model=NetworkResponse, tags=["network"])
    def network(request: Request):
        runtime = request.app.state.runtime
        fingerprint = runtime.signatures.fingerprint

        def compute():
            payload = runtime.hydraulics.network_payload()
            payload["default_sensors"] = runtime.hydraulics.default_sensors(settings.default_sensors_k)
            return payload

        return cached_dto(runtime, NetworkResponse, "network",
                          (fingerprint, settings.default_sensors_k,
                           settings.sensor_distance_metric), compute)

    app.include_router(scenarios_router)
    app.include_router(detection_router)
    return app


app = create_app()
