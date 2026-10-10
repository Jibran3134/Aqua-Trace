"""Strict, read-only numerical tools and an explicit crew feedback command."""

from __future__ import annotations

import hashlib
import json
import math
from typing import Annotated, Literal

import networkx as nx
import numpy as np
from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, ValidationError, model_validator

from app.core.config import Settings
from app.core.errors import DomainError
from app.domain.models import ScenarioState
from app.schemas.api import Candidate, Evidence, FieldResponse, NodeId


class ToolDTO(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False,
                              hide_input_in_errors=True)


ToolNode = Annotated[str, Field(strict=True, pattern=r"^[A-Za-z0-9_.:-]{1,64}$")]


class RankArgs(ToolDTO):
    top_k: Annotated[int, Field(ge=1, le=10)] = 3


class HypothesisArgs(ToolDTO):
    node: ToolNode


class PlanArgs(ToolDTO):
    nodes: Annotated[list[ToolNode], Field(min_length=1, max_length=3)]
    depot: ToolNode | None = None

    @model_validator(mode="after")
    def unique_nodes(self):
        if len(set(self.nodes)) != len(self.nodes):
            raise ValueError("inspection nodes must be unique")
        return self


class EmptyArgs(ToolDTO):
    pass


class RankResult(ToolDTO):
    status: Literal["ok", "insufficient_evidence"]
    candidates: list[Candidate]
    evidence: Evidence
    note: str | None


class SensorFit(ToolDTO):
    sensor: NodeId
    observed: FiniteFloat
    predicted: FiniteFloat


class HypothesisResult(ToolDTO):
    node: NodeId
    alpha: Annotated[FiniteFloat, Field(ge=0)]
    rmse: Annotated[FiniteFloat, Field(ge=0)]
    fit_label: Literal["good", "fair", "poor"]
    per_sensor: list[SensorFit]
    provenance: Literal["simulated: signature fit in the detector's transformed pressure space"] = (
        "simulated: signature fit in the detector's transformed pressure space"
    )


class RouteLeg(ToolDTO):
    from_node: NodeId = Field(alias="from")
    to: NodeId
    length_m: Annotated[FiniteFloat, Field(ge=0)]
    path: list[NodeId]


class PlanResult(ToolDTO):
    order: list[NodeId]
    total_length_m: Annotated[FiniteFloat, Field(ge=0)]
    legs: list[RouteLeg]
    depot: NodeId
    provenance: str = "simulated: pipe-length shortest paths, not road travel distances"


class SensorResult(ToolDTO):
    recommended: NodeId | None
    candidates_compared: list[NodeId]
    signature_difference_m: Annotated[FiniteFloat, Field(ge=0)]
    reason: str
    provenance: str = "simulated: reference-signature separation, not a guaranteed field benefit"


ARGUMENT_MODELS = {
    "rank_candidates": RankArgs,
    "simulate_hypothesis": HypothesisArgs,
    "plan_inspection": PlanArgs,
    "recommend_sensor_addition": EmptyArgs,
}
RESULT_MODELS = {
    "rank_candidates": RankResult,
    "simulate_hypothesis": HypothesisResult,
    "plan_inspection": PlanResult,
    "recommend_sensor_addition": SensorResult,
}
_DESCRIPTIONS = {
    "rank_candidates": "Rank uninspected candidates from public sensor readings.",
    "simulate_hypothesis": "Fit one candidate signature in detector residual space.",
    "plan_inspection": "Plan pipe-network paths through up to three uninspected candidates.",
    "recommend_sensor_addition": "Find a sensor that separates the leading two candidates.",
}
TOOL_SCHEMAS = [
    {"type": "function", "function": {"name": name, "description": _DESCRIPTIONS[name],
                                     "parameters": model.model_json_schema()}}
    for name, model in ARGUMENT_MODELS.items()
]


def invalid_tool() -> DomainError:
    return DomainError("invalid_tool_arguments", "The tool arguments are not permitted.",
                       "Use the documented read-only tool and validated candidate IDs.", 422)


class InvestigationTools:
    def __init__(self, settings: Settings, hydraulics, detector, signatures) -> None:
        self.settings = settings
        self.hydraulics = hydraulics
        self.detector = detector
        self.signatures = signatures

    def validate_args(self, name: str, arguments: dict) -> dict:
        if name not in ARGUMENT_MODELS or not isinstance(arguments, dict):
            raise invalid_tool()
        try:
            return ARGUMENT_MODELS[name].model_validate(arguments).model_dump(mode="json")
        except ValidationError:
            raise invalid_tool() from None

    def execute(self, state: ScenarioState, name: str, arguments: dict) -> dict:
        args = self.validate_args(name, arguments)
        result = getattr(self, name)(state, **args)
        # A fixed output DTO is the external-provider boundary, including cache hits.
        return RESULT_MODELS[name].model_validate(result).model_dump(mode="json", by_alias=True)

    def rank_candidates(self, state: ScenarioState, top_k: int = 3) -> dict:
        self.validate_args("rank_candidates", {"top_k": top_k})
        detection = self.detector.analyze(state.observation, state.weights or None)
        order = sorted((n for n in detection.weights if n not in state.inspected),
                       key=lambda n: (-round(detection.weights[n], 12), n))
        candidates = [Candidate(node=node, score=detection.weights[node],
                                adjacent_pipes=self.hydraulics.adjacent_pipes(node),
                                est_leak_lps=max(0.0, detection.alphas[node]
                                                * float(self.signatures.reference_flows[
                                                    self.signatures.candidate_order.index(node)])))
                      for node in order[:top_k]]
        evidence = detection.response.evidence.model_copy(deep=True)
        evidence.margin_top1_vs_top2 = (
            min(1e12, detection.weights[order[0]] / max(detection.weights[order[1]],
                                                       np.finfo(float).tiny))
            if len(order) > 1 else (1e12 if order else 0.0)
        )
        status = detection.response.status if order else "insufficient_evidence"
        return RankResult(status=status, candidates=candidates, evidence=evidence,
                          note=detection.response.note if order else
                          "No uninspected candidates remain.").model_dump(mode="json")

    def _candidate(self, state: ScenarioState, node: str) -> None:
        self.hydraulics.validate_junction(node)
        if node not in self.signatures.candidate_order or node in state.inspected:
            raise invalid_tool()

    def simulate_hypothesis(self, state: ScenarioState, node: str) -> dict:
        self.validate_args("simulate_hypothesis", {"node": node})
        self._candidate(state, node)
        cache = getattr(self.detector, "redis", None)
        identity = hashlib.sha256(json.dumps({
            "sensors": state.observation.sensors, "readings": state.observation.readings,
            "noise_sigma": state.observation.noise_sigma,
        }, sort_keys=True, allow_nan=False).encode()).hexdigest()
        key = (cache.cache_key("hypothesis-v1", self.detector.fingerprint, state.id,
                               state.revision, node, identity) if cache else None)
        cached = cache.get_json(key) if cache else None
        live, residual, matrix = self.detector.fit_inputs(state.observation)
        if not live:
            raise DomainError("insufficient_evidence", "No live sensor readings are available.",
                              "Collect sensor readings before fitting a hypothesis.", 422)
        if cached is not None:
            try:
                result = HypothesisResult.model_validate(cached)
                if result.node == node and [row.sensor for row in result.per_sensor] == live:
                    return result.model_dump(mode="json")
            except ValidationError:
                pass
        column = matrix[:, self.signatures.candidate_order.index(node)]
        alpha = max(0.0, float(column @ residual) / (float(column @ column) + 1e-12))
        predicted = alpha * column
        rmse = float(np.sqrt(np.mean((residual - predicted) ** 2)))
        result = HypothesisResult(
            node=node, alpha=alpha, rmse=rmse,
            fit_label=("good" if rmse <= max(.05, 1.5 * state.observation.noise_sigma) else
                       "fair" if rmse <= max(.05, 3 * state.observation.noise_sigma) else "poor"),
            per_sensor=[SensorFit(sensor=n, observed=float(r), predicted=float(p))
                     for n, r, p in zip(live, residual, predicted, strict=True)],
        ).model_dump(mode="json")
        if cache:
            cache.set_json(key, result)
        return result

    def plan_inspection(self, state: ScenarioState, nodes: list[str],
                        depot: str | None = None) -> dict:
        self.validate_args("plan_inspection", {"nodes": nodes, "depot": depot})
        for node in nodes:
            self._candidate(state, node)
        graph = self.hydraulics.graph()
        if depot is None:
            reservoirs = sorted(n["id"] for n in self.hydraulics.network_payload()["nodes"]
                                if n["type"] == "reservoir")
            depot = reservoirs[0] if reservoirs else nodes[0]
        if depot not in graph:
            raise invalid_tool()
        # Preserve the leading candidate as the first stop, then shorten the remaining route.
        remaining = list(nodes[1:])
        order = [nodes[0]]
        try:
            while remaining:
                distances = nx.single_source_dijkstra_path_length(graph, order[-1], weight="weight")
                next_node = min(remaining, key=lambda n: (distances.get(n, math.inf), n))
                order.append(next_node)
                remaining.remove(next_node)
            legs = []
            current = depot
            for node in order:
                length, path = nx.single_source_dijkstra(graph, current, node, weight="weight")
                legs.append(RouteLeg(**{"from": current, "to": node, "length_m": length,
                                        "path": path}))
                current = node
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            raise DomainError("route_unavailable", "The inspection route is disconnected.",
                              "Choose candidates in the same network component.", 422) from None
        return PlanResult(order=order, total_length_m=sum(leg.length_m for leg in legs),
                          legs=legs, depot=depot).model_dump(mode="json", by_alias=True)

    def recommend_sensor_addition(self, state: ScenarioState) -> dict:
        ranked = RankResult.model_validate(self.rank_candidates(state, 2))
        leading = [c.node for c in ranked.candidates]
        if len(leading) < 2:
            return SensorResult(recommended=None, candidates_compared=leading,
                                signature_difference_m=0,
                                reason="Two uninspected candidates are required.").model_dump()
        if ranked.status == "ok" and ranked.evidence.margin_top1_vs_top2 >= 2:
            return SensorResult(recommended=None, candidates_compared=leading,
                                signature_difference_m=0,
                                reason="Current readings separate the leading candidates.").model_dump()
        self.signatures.ensure_ready()
        columns = [self.signatures.candidate_order.index(n) for n in leading]
        available = sorted(n for n in self.hydraulics.candidate_nodes()
                           if n not in state.observation.sensors
                           and float(self.signatures.baseline[
                               self.signatures.node_order.index(n)]) > 0)
        if not available:
            return SensorResult(recommended=None, candidates_compared=leading,
                                signature_difference_m=0,
                                reason="All candidate junctions already have sensors.").model_dump()
        differences = {n: abs(float(self.signatures.matrix[
            self.signatures.node_order.index(n), columns[0]]) - float(self.signatures.matrix[
                self.signatures.node_order.index(n), columns[1]])) for n in available}
        best = max(available, key=lambda n: differences[n])
        if differences[best] <= 1e-12:
            return SensorResult(recommended=None, candidates_compared=leading,
                                signature_difference_m=0,
                                reason="No available sensor separates the leading signatures.").model_dump()
        return SensorResult(recommended=best, candidates_compared=leading,
                            signature_difference_m=differences[best],
                            reason="Add a sensor to separate the leading signatures.").model_dump()


def record_field_result(state: ScenarioState, node: str, found: bool,
                        miss_prob: float = .05) -> dict:
    """Pure crew command; the HTTP caller owns validation, row locking and commit."""
    if (type(found) is not bool or node not in state.weights or not state.weights
            or isinstance(miss_prob, bool) or not math.isfinite(miss_prob)
            or not 0 < miss_prob < 1
            or any(isinstance(v, bool) or not isinstance(v, (int, float))
                   or not math.isfinite(v) or v < 0 for v in state.weights.values())
            or not any(state.weights.values())):
        raise invalid_tool()
    if node in state.inspected:
        if state.inspected[node] is not found:
            raise DomainError("conflicting_report", "A different report already exists for this node.",
                              "Use the existing recorded crew outcome.", 409)
    elif state.resolved:
        raise DomainError("scenario_resolved", "This investigation is already resolved.",
                          "Create a new scenario for another investigation.", 409)
    else:
        maximum = max(state.weights.values())
        updated = {n: max(np.finfo(float).tiny, value / maximum)
                   for n, value in state.weights.items()}
        if not found:
            updated[node] = max(np.finfo(float).tiny, updated[node] * miss_prob)
        total = math.fsum(updated.values())
        state.weights = {n: max(np.finfo(float).tiny, value / total)
                         for n, value in updated.items()}
        state.inspected[node] = found
        state.resolved = found
    order = sorted(state.weights, key=lambda n: (-round(state.weights[n], 12), n))
    return FieldResponse(state="resolved" if state.resolved else "investigating",
                         ranking=[{"node": n, "score": state.weights[n]} for n in order[:10]]
                         ).model_dump(mode="json")
