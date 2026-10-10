"""Observation-only investigation turns and transactional crew reports."""
from copy import deepcopy

import anyio
from fastapi import APIRouter, Request

from app.api.dependencies import require_compatible_scenario
from app.core.errors import DomainError
from app.db.repository import ScenarioRepository
from app.investigation.llm import LLMUnavailable
from app.investigation.tools import record_field_result
from app.schemas.api import AgentRequest, AgentResponse, FieldRequest, FieldResponse

router = APIRouter(tags=["investigation"])
HISTORY_LIMIT = 120


@router.post("/agent/step", response_model=AgentResponse)
def agent_step(body: AgentRequest, request: Request) -> AgentResponse:
    runtime = request.app.state.runtime
    runtime.signatures.ensure_ready()
    with runtime.database.sessions() as session:
        state = ScenarioRepository(session).load(body.scenario_id)
    require_compatible_scenario(runtime, state)
    if not state.weights:
        state.weights = runtime.detector.analyze(state.observation).weights
    if body.mode == "scripted" or runtime.settings.demo_mode or state.resolved:
        response = runtime.scripted.run(state)
    else:
        try:
            response = anyio.from_thread.run(runtime.llm.run, state)
        except LLMUnavailable:
            response = runtime.scripted.run(state)
    # Providers and numerical tools run without a database transaction or row lock.
    # A concurrent crew report wins; the stale turn is rejected instead of overwriting it.
    response = AgentResponse.model_validate(response)
    state.history = (state.history + [event.model_dump(mode="json", exclude_none=True)
                                     for event in response.events])[-HISTORY_LIMIT:]
    with runtime.database.sessions.begin() as session:
        ScenarioRepository(session).save(state, expected_revision=state.revision)
    return response


@router.post("/field/result", response_model=FieldResponse)
def field_result(body: FieldRequest, request: Request) -> FieldResponse:
    runtime = request.app.state.runtime
    runtime.signatures.ensure_ready()
    runtime.hydraulics.validate_junction(body.node)
    if body.node not in runtime.signatures.candidate_order:
        raise DomainError("invalid_candidate", "This junction is not a valid leak candidate.",
                          "Choose a node from the returned candidate ranking.", 422)
    with runtime.database.sessions() as session:
        snapshot = ScenarioRepository(session).load(body.scenario_id)
    require_compatible_scenario(runtime, snapshot)
    initial_weights = (snapshot.weights or
                       runtime.detector.analyze(snapshot.observation).weights)
    if not initial_weights:
        raise DomainError("insufficient_evidence", "No live readings are available for this report.",
                          "Create a scenario with live sensors and run detection first.", 422)
    with runtime.database.sessions.begin() as session:
        repository = ScenarioRepository(session)
        state = repository.load(body.scenario_id, for_update=True)
        require_compatible_scenario(runtime, state)
        before = deepcopy((state.weights, state.inspected, state.resolved))
        state.weights = state.weights or initial_weights
        result = record_field_result(state, body.node, body.found, runtime.settings.miss_prob)
        if before != (state.weights, state.inspected, state.resolved):
            state.history = (state.history + [{"type": "field_report", "node": body.node,
                                               "found": body.found}])[-HISTORY_LIMIT:]
            repository.save(state, expected_revision=state.revision)
    return FieldResponse.model_validate(result)
