"""Bounded, deterministic WNTR simulations without exposing private inputs."""

from __future__ import annotations

import copy
import math
from dataclasses import dataclass
from functools import cached_property
from threading import BoundedSemaphore
from time import perf_counter

import networkx as nx
import numpy as np
import wntr

from app.core.config import (
    DISCHARGE_COEFF,
    MINIMUM_PRESSURE_M,
    REQUIRED_PRESSURE_M,
    Settings,
)
from app.core.errors import DomainError


class SimulationError(DomainError):
    """A failed physical computation, with no private scenario details."""

    def __init__(self) -> None:
        super().__init__(
            "simulation_failed",
            "The hydraulic simulation could not produce usable pressures.",
            "Try a smaller leak or another seed; check the network calibration.",
            503,
        )


@dataclass(frozen=True)
class SimulationResult:
    """Internal result; effective area and flow belong in private truth storage."""

    pressures: dict[str, float]
    leak_flow_lps: float | None
    effective_area_m2: float | None
    retry_count: int


class HydraulicService:
    """Own an immutable template and create a fresh model for each simulation."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._semaphore = BoundedSemaphore(settings.simulation_concurrency)
        self._template = wntr.network.WaterNetworkModel(str(settings.net_file))
        self._template.options.hydraulic.demand_model = "PDD"
        self._template.options.hydraulic.minimum_pressure = MINIMUM_PRESSURE_M
        self._template.options.hydraulic.required_pressure = REQUIRED_PRESSURE_M
        self._template.options.hydraulic.pressure_exponent = 0.5
        self._template.options.time.duration = 0
        self._template.options.time.report_start = 0
        self._candidates = sorted(self._template.junction_name_list)
        self.last_run_seconds: float | None = None

    def candidate_nodes(self) -> list[str]:
        """Return all junctions, including junctions with zero base demand."""
        return self._candidates.copy()

    @cached_property
    def _network_graph(self) -> nx.Graph:
        # Preserve the shortest parallel connection in the routing graph.
        # Pumps/valves are zero-length structural connectors, not surveyed roads.
        graph = nx.Graph()
        graph.add_nodes_from(self._template.node_name_list)
        for name, link in self._template.links():
            start, end = link.start_node_name, link.end_node_name
            length = float(getattr(link, "length", 0.0))
            if graph.has_edge(start, end):
                graph[start][end]["links"].append(name)
                if length < graph[start][end]["weight"]:
                    graph[start][end]["weight"] = length
                    graph[start][end]["length"] = length
            else:
                graph.add_edge(start, end, weight=length, length=length, links=[name])
        return nx.freeze(graph)

    def graph(self) -> nx.Graph:
        """Return an independent structural graph with pipe-length SI weights."""
        return self._network_graph.copy()

    def adjacent_pipes(self, node: str) -> list[str]:
        """Return adjacent actual pipe IDs; exclude pumps and valves."""
        self.validate_junction(node)
        return sorted(
            name for name, pipe in self._template.pipes()
            if node in (pipe.start_node_name, pipe.end_node_name)
        )

    def validate_junction(self, node: str) -> None:
        """Reject non-junction identifiers before interacting with WNTR."""
        if node not in self._candidates:
            raise DomainError(
                "invalid_node", "The node must be a junction in this network.",
                "Choose a junction ID from GET /network.", 422,
            )

    def network_payload(self) -> dict:
        """Expose structural network data only, using SI pipe lengths."""
        nodes = [
            {"id": name, "x": float(node.coordinates[0]), "y": float(node.coordinates[1]),
             "type": node.node_type.lower()}
            for name, node in self._template.nodes()
        ]
        pipes = [
            {"id": name, "from": link.start_node_name, "to": link.end_node_name,
             "length": float(getattr(link, "length", 0.0)), "type": link.link_type.lower()}
            for name, link in self._template.links()
        ]
        return {"nodes": nodes, "pipes": pipes}

    def default_sensors(self, k: int) -> list[str]:
        """Spread sensors by deterministic farthest-point structural graph hops."""
        candidates = self._sensor_candidates
        if isinstance(k, bool) or not isinstance(k, int) or not 1 <= k <= len(candidates):
            raise DomainError(
                "invalid_sensor_count", "Sensor count is outside the network's range.",
                f"Choose a count between 1 and {len(candidates)}.", 422,
            )
        selected = [candidates[0]]
        distance = {node: math.inf for node in candidates}
        while len(selected) < k:
            latest = (
                nx.single_source_shortest_path_length(self._network_graph, selected[-1])
                if self.settings.sensor_distance_metric == "hops"
                else nx.single_source_dijkstra_path_length(
                    self._network_graph, selected[-1], weight="weight"
                )
            )
            for node in candidates:
                distance[node] = min(distance[node], latest.get(node, math.inf))
            remaining = [node for node in candidates if node not in selected]
            # Sorted candidates make equal-distance decisions reproducible.
            selected.append(max(remaining, key=lambda node: distance[node]))
        return selected

    @cached_property
    def _sensor_candidates(self) -> list[str]:
        """Avoid allocating default sensors to baseline nonpositive-head junctions."""
        baseline = self.run()
        return [node for node in self._candidates if baseline.pressures[node] > 0]

    @cached_property
    def _baseline_negative_nodes(self) -> frozenset[str]:
        """Identify the documented Net3 t=0 zero-demand exception, if present."""
        try:
            model = copy.deepcopy(self._template)
            result = wntr.sim.WNTRSimulator(model).run_sim(convergence_error=True)
            pressures = result.node["pressure"].loc[0]
            return frozenset({"10"} if "10" in pressures and pressures["10"] < 0 else {})
        except (RuntimeError, ValueError, ArithmeticError, KeyError, IndexError):
            raise SimulationError() from None

    def run(
        self, leak_node: str | None = None, leak_area: float | None = None,
        demand_mult: float = 1.0,
    ) -> SimulationResult:
        """Simulate t=0; retry an invalid leak once at half its original area."""
        if not math.isfinite(demand_mult) or demand_mult <= 0:
            raise DomainError("invalid_demand", "Demand multiplier must be positive and finite.",
                              "Use a positive numeric demand multiplier.", 422)
        if (leak_node is None) != (leak_area is None):
            raise DomainError("invalid_leak", "Leak node and area must be supplied together.",
                              "Supply both a junction and a positive area, or neither.", 422)
        if leak_node is not None:
            self.validate_junction(leak_node)
            if not math.isfinite(leak_area) or leak_area <= 0:
                raise DomainError("invalid_leak", "Leak area must be positive and finite.",
                                  "Use a positive area in square metres.", 422)
        started = perf_counter()
        with self._semaphore:
            for retry in range(2 if leak_node is not None else 1):
                area = leak_area / (2 ** retry) if leak_area is not None else None
                try:
                    model = copy.deepcopy(self._template)
                    model.options.hydraulic.demand_multiplier = demand_mult
                    if leak_node is not None:
                        model.get_node(leak_node).add_leak(
                            model, area=area, discharge_coeff=DISCHARGE_COEFF, start_time=0,
                        )
                    results = wntr.sim.WNTRSimulator(model).run_sim(convergence_error=True)
                    pressure = results.node["pressure"].loc[0]
                    values = pressure.loc[self._candidates].to_numpy(dtype=float)
                    negative_nodes = {
                        node for node in self._candidates if pressure[node] < -1e-6
                    }
                    if (not np.isfinite(values).all()
                            or not negative_nodes.issubset(self._baseline_negative_nodes)
                            or (leak_node is not None and pressure[leak_node] <= 0)):
                        raise ValueError("Unusable junction pressure")
                    flow = None
                    if leak_node is not None:
                        if "leak_demand" in results.node:
                            flow = float(results.node["leak_demand"].loc[0, leak_node]) * 1000
                        else:
                            flow = (DISCHARGE_COEFF * area
                                    * math.sqrt(2 * 9.81 * max(float(pressure[leak_node]), 0))
                                    * 1000)
                        if not math.isfinite(flow) or flow < -1e-8:
                            raise ValueError("Unusable leak flow")
                    self.last_run_seconds = perf_counter() - started
                    return SimulationResult(
                        {str(node): round(float(value), 8) for node, value in pressure.items()},
                        round(flow, 8) if flow is not None else None, area, retry,
                    )
                except (RuntimeError, ValueError, ArithmeticError, KeyError, IndexError):
                    # Exception details can include the hidden leak ID: never propagate them.
                    if retry == (1 if leak_node is not None else 0):
                        raise SimulationError() from None
        raise SimulationError()
