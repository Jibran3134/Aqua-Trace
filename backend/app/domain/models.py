"""Private internal models. Public responses use explicit Pydantic projections."""

from dataclasses import dataclass, field


@dataclass
class ScenarioObservation:
    """Detector data. Full pressures exist only for offline sensor evaluation."""

    seed: int
    sensors: list[str]
    readings: dict[str, float | None]
    noise: str
    noise_sigma: float
    pressures_all: dict[str, float] = field(default_factory=dict)
    hydraulic_fingerprint: str = ""
    detector_fingerprint: str = ""


@dataclass
class ScenarioTruth:
    """Ground truth, separately persisted and accessed only by explicit reveal."""

    true_leak_node: str
    true_size: str
    demand_mult: float
    effective_area_m2: float
    leak_flow_lps: float
    retry_count: int = 0


@dataclass
class ScenarioState:
    """Persisted investigation state, without hidden truth."""

    id: str
    observation: ScenarioObservation
    weights: dict[str, float] = field(default_factory=dict)
    inspected: dict[str, bool] = field(default_factory=dict)
    resolved: bool = False
    history: list[dict] = field(default_factory=list)
    revision: int = 0
