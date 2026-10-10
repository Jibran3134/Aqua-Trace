"""Scenario generation API projects observations and persists truth separately."""
from secrets import randbits

from fastapi import APIRouter, Request
from sqlalchemy import text

from app.db.repository import ScenarioRepository
from app.schemas.api import LeakRequest, LeakResponse, ScenarioMeta

router = APIRouter(tags=["scenarios"])


@router.post("/scenario/leak", response_model=LeakResponse)
def create_scenario(body: LeakRequest, request: Request) -> LeakResponse:
    """Generate physical observations without identifying the hidden leak."""
    runtime = request.app.state.runtime
    runtime.signatures.ensure_ready()
    observation, truth = runtime.generator.make(
        seed=body.seed if body.seed is not None else randbits(32),
        size=body.size, noise=body.noise, sensors=body.sensors, k=body.k,
    )
    observation.hydraulic_fingerprint = runtime.signatures.fingerprint
    observation.detector_fingerprint = runtime.detector.fingerprint
    with runtime.database.sessions.begin() as session:
        # A transaction-scoped lock enforces retention even across concurrent replicas.
        # It is PostgreSQL correctness, independent of disposable Redis locks.
        session.execute(text("SELECT pg_advisory_xact_lock(724828193)"))
        repository = ScenarioRepository(session)
        scenario_id = repository.create(observation, truth)
        repository.cleanup()
    return LeakResponse(scenario_id=scenario_id, sensors=observation.sensors,
                        readings=observation.readings,
                        meta=ScenarioMeta(noise_sigma=observation.noise_sigma,
                                          noise_level=observation.noise))
