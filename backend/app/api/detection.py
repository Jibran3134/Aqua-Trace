"""Current rankings and explicit reveal are separate HTTP projections."""
import networkx as nx
from fastapi import APIRouter, Request

from app.api.cache import cached_dto
from app.db.repository import ScenarioRepository
from app.schemas.api import DetectionResponse, RevealResponse, ScenarioRequest

router = APIRouter(tags=["detection"])


@router.post("/detect", response_model=DetectionResponse)
def detect(body: ScenarioRequest, request: Request) -> DetectionResponse:
    """Rank observation-only data; use revision-specific public caching."""
    runtime = request.app.state.runtime
    runtime.signatures.ensure_ready()
    with runtime.database.sessions() as session:
        state = ScenarioRepository(session).load(body.scenario_id)
    # No database lock is held across numerical calculation.
    if not state.weights:
        result = runtime.detector.analyze(state.observation)
        state.weights = result.weights
        if state.weights:
            with runtime.database.sessions.begin() as session:
                ScenarioRepository(session).save(state, expected_revision=state.revision)
        return result.response
    return cached_dto(runtime, DetectionResponse, "detection",
                      (runtime.detector.fingerprint, state.id, state.revision),
                      lambda: runtime.detector.analyze(state.observation, state.weights).response)


@router.get("/scenario/{scenario_id}/reveal", response_model=RevealResponse)
def reveal(scenario_id: str, request: Request) -> RevealResponse:
    """This is the sole HTTP route allowed to read private hydraulic truth."""
    runtime = request.app.state.runtime
    runtime.signatures.ensure_ready()
    with runtime.database.sessions() as session:
        repository = ScenarioRepository(session)
        state = repository.load(scenario_id)
        truth = repository.reveal(scenario_id)
    detection = runtime.detector.analyze(state.observation, state.weights)
    ranking = sorted(detection.weights, key=lambda node: (-round(detection.weights[node], 12), node))
    rank = ranking.index(truth.true_leak_node) + 1 if truth.true_leak_node in ranking else None
    try:
        hop = nx.shortest_path_length(runtime.hydraulics.graph(), ranking[0], truth.true_leak_node)
    except (nx.NetworkXNoPath, nx.NodeNotFound, IndexError):
        hop = None
    return RevealResponse(true_leak_node=truth.true_leak_node, true_size=truth.true_size,
                          rank_of_truth=rank, hop_error_top1=hop)
