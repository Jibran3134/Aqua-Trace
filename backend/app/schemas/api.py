"""Frontend contract: bounded requests and explicit responses exclude private truth."""

from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, model_validator

NodeId = Annotated[str, Field(pattern=r"^[A-Za-z0-9_.:-]{1,64}$")]
Size = Literal["small", "medium", "large"]
Noise = Literal["low", "mid", "high"]


class DTO(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ErrorDetail(DTO):
    code: str
    message: str
    hint: str


class ErrorResponse(DTO):
    error: ErrorDetail


class HealthResponse(DTO):
    status: Literal["ok", "degraded"]
    signatures_ready: bool
    signatures_progress: float = 0
    progress: Annotated[FiniteFloat, Field(ge=0, le=1)] = 0
    database: Literal["ok", "unavailable"]
    redis: Literal["ok", "unavailable"]


class NetworkNode(DTO):
    id: NodeId
    x: FiniteFloat
    y: FiniteFloat
    type: Literal["junction", "reservoir", "tank"]


class NetworkPipe(DTO):
    id: NodeId
    from_node: NodeId = Field(alias="from")
    to: NodeId
    length: Annotated[FiniteFloat, Field(ge=0)]
    type: Literal["pipe", "pump", "valve"] = "pipe"
    kind: Literal["pipe", "pump", "valve"] | None = None

    @model_validator(mode="after")
    def link_kind(self):
        self.kind = self.type if self.kind is None else self.kind
        return self


class NetworkResponse(DTO):
    nodes: list[NetworkNode]
    pipes: list[NetworkPipe]
    default_sensors: list[NodeId]
    provenance: dict[str, str] = Field(default_factory=lambda: {
        "coordinates": "assumed: Net3 schematic coordinates, not geographic",
        "length": "simulated: Net3 pipe length in metres; pump connector length assumed",
    })


class LeakRequest(DTO):
    seed: Annotated[int, Field(ge=0, le=2**32-1, strict=True)] | None = None
    size: Size | None = None
    noise: Noise = "mid"
    sensors: Annotated[list[NodeId], Field(min_length=1, max_length=12)] | None = None
    k: Annotated[int, Field(ge=1, le=12, strict=True)] = 6

    @model_validator(mode="after")
    def unique_sensors(self):
        if self.sensors and len(set(self.sensors)) != len(self.sensors):
            raise ValueError("sensors must contain unique node IDs")
        return self


class ScenarioMeta(DTO):
    time_step: Literal["t0"] = "t0"
    noise_sigma: FiniteFloat
    noise_level: Noise = "mid"
    demand_mult_known: Literal[False] = False
    provenance: dict[str, str] = Field(default_factory=lambda: {
        "readings": "simulated: hydraulic pressure in metres with synthetic sensor noise",
        "noise_sigma": "assumed: sensor noise standard deviation in metres",
    })


class LeakResponse(DTO):
    scenario_id: UUID
    sensors: list[NodeId]
    readings: dict[NodeId, FiniteFloat | None]
    meta: ScenarioMeta


class ScenarioRequest(DTO):
    scenario_id: UUID


class Candidate(DTO):
    node: NodeId
    score: Annotated[FiniteFloat, Field(ge=0, le=1)]
    adjacent_pipes: list[NodeId]
    est_leak_lps: Annotated[FiniteFloat, Field(ge=0)]
    tie_group: int | None = None


class Evidence(DTO):
    residual_norm: Annotated[FiniteFloat, Field(ge=0)]
    noise_floor: Annotated[FiniteFloat, Field(ge=0)]
    margin_top1_vs_top2: Annotated[FiniteFloat, Field(ge=0)]
    live_sensors: int


class DetectionResponse(DTO):
    status: Literal["ok", "insufficient_evidence"]
    candidates: list[Candidate]
    evidence: Evidence
    note: str | None = None
    provenance: dict[str, str] = Field(default_factory=lambda: {
        "score": "simulated: relative fit score, not a calibrated probability",
        "est_leak_lps": "simulated: signature-based leak-flow estimate in litres per second",
        "evidence": "simulated: pressure residuals in metres, calibrated synthetic noise floor",
    })


class AgentRequest(ScenarioRequest):
    mode: Literal["auto", "scripted", "llm"] = "auto"


class AgentEvent(DTO):
    step: Annotated[int, Field(ge=1)]
    type: Literal["thought", "tool_call", "tool_result", "recommendation", "abstain", "final"]
    name: str | None = None
    args: dict[str, Any] | None = None
    result: Any | None = None
    text: str | None = None


class AgentResponse(DTO):
    events: list[AgentEvent]
    source: Literal["llm", "scripted"]
    recommended_node: NodeId | None = None
    route: list[NodeId] | None = None
    state: Literal["investigating", "resolved", "abstained"]
    recommended_sensor: NodeId | None = None
    route_length_m: Annotated[FiniteFloat, Field(ge=0)] = 0
    inspections_used: Annotated[int, Field(ge=0)] = 0


class FieldRequest(ScenarioRequest):
    node: NodeId
    found: Annotated[bool, Field(strict=True)]


class RankedNode(DTO):
    node: NodeId
    score: Annotated[FiniteFloat, Field(ge=0, le=1)]


class FieldResponse(DTO):
    state: Literal["investigating", "resolved"]
    ranking: list[RankedNode]


class RevealResponse(DTO):
    true_leak_node: NodeId
    true_size: Size
    rank_of_truth: int | None
    hop_error_top1: int | None
    provenance: Literal["simulated: hidden hydraulic ground truth"] = "simulated: hidden hydraulic ground truth"


class PlacementRequest(DTO):
    k: Annotated[int, Field(ge=1, le=12, strict=True)]


class AccuracyPoint(DTO):
    k: int
    top1: Annotated[FiniteFloat, Field(ge=0, le=1)]
    top3: Annotated[FiniteFloat, Field(ge=0, le=1)]


class PlacementResponse(DTO):
    sensors: list[NodeId]
    curve: list[AccuracyPoint]
    provenance: str = "simulated: validation-seed performance; does not guarantee field accuracy"


class RepairCandidate(DTO):
    node: NodeId
    est_leak_lps: Annotated[FiniteFloat, Field(ge=0, le=10000, strict=True)]
    repair_cost_pkr: Annotated[FiniteFloat, Field(gt=0, le=1e9, strict=True)] | None = None


class RepairRequest(DTO):
    budget_pkr: Annotated[FiniteFloat, Field(ge=0, le=1e9, strict=True)]
    candidates: Annotated[list[RepairCandidate], Field(max_length=50)]

    @model_validator(mode="after")
    def unique_nodes(self):
        if len({c.node for c in self.candidates}) != len(self.candidates):
            raise ValueError("repair candidates must contain unique nodes")
        return self


class RepairSelection(DTO):
    nodes: list[NodeId]
    total_cost_pkr: FiniteFloat
    litres_per_day: FiniteFloat


class RepairResponse(DTO):
    selected: RepairSelection
    greedy: RepairSelection
    budget_pkr: FiniteFloat
    defaulted_cost_nodes: list[NodeId]
    assumptions: dict[str, Any]
    note: str = "Assumes independent leaks; savings are simulated estimates."


class EvaluationResponse(DTO):
    meta: dict[str, Any]
    results: dict[str, Any]
    baseline: dict[str, Any]
    by_noise: dict[str, Any]
    by_size: dict[str, Any]
    by_k: dict[str, Any]
    gate: dict[str, Any]
