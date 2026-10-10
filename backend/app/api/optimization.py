"""Frontend-facing deterministic optimization endpoints."""
from fastapi import APIRouter, Request

from app.optimization.repair import optimize
from app.schemas.api import RepairRequest, RepairResponse

router = APIRouter(tags=["optimization"])


@router.post("/repair/optimize", response_model=RepairResponse)
def repair(body: RepairRequest, request: Request) -> RepairResponse:
    runtime = request.app.state.runtime
    for item in body.candidates:
        runtime.hydraulics.validate_junction(item.node)
    return RepairResponse.model_validate(optimize(
        body.budget_pkr, [item.model_dump() for item in body.candidates], body.value_per_litre_pkr))
