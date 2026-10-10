"""Reproducible physical calibration artifact: python -m app.hydraulics.calibrate."""

import json
from pathlib import Path
from time import perf_counter

import networkx as nx
import numpy as np
import wntr

from app.core.config import LEAK_AREAS_M2, Settings
from app.hydraulics.fingerprint import NETWORK_HASH_POLICY, canonical_network_sha256
from app.hydraulics.service import HydraulicService, SimulationError


def calibrate(output: Path | None = None) -> dict:
    """Measure five fixed seeded junctions, three sizes and ten nearest junctions."""
    settings = Settings()
    hydraulics = HydraulicService(settings)
    started = perf_counter()
    baseline = hydraulics.run()
    baseline_seconds = perf_counter() - started
    eligible = [n for n in hydraulics.candidate_nodes() if baseline.pressures[n] > 0]
    samples = [str(n) for n in np.random.default_rng(2026).choice(eligible, 5, replace=False)]
    rows = []
    for node in samples:
        distance = nx.single_source_dijkstra_path_length(hydraulics.graph(), node, weight="weight")
        nearest = sorted(eligible, key=lambda name: (distance.get(name, float("inf")), name))[:10]
        for size, area in LEAK_AREAS_M2.items():
            try:
                result = hydraulics.run(node, area)
                rows.append({
                    "node": node, "size": size, "requested_area_m2": area,
                    "effective_area_m2": result.effective_area_m2, "retry_count": result.retry_count,
                    "leak_flow_lps": result.leak_flow_lps,
                    "local_drop_m": round(baseline.pressures[node] - result.pressures[node], 8),
                    "nearby": [{"node": name, "distance_m": distance[name],
                                "drop_m": round(baseline.pressures[name]-result.pressures[name], 8)}
                               for name in nearest],
                })
            except SimulationError:
                rows.append({"node": node, "size": size, "failed": True})
    artifact = {
        "network": "Net3", "network_sha256": canonical_network_sha256(settings.net_file),
        "network_hash_policy": NETWORK_HASH_POLICY,
        "wntr": wntr.__version__, "seed": 2026, "time_step": "t0",
        "baseline_seconds_measured": baseline_seconds,
        "baseline_negative_pressures_m": {n: p for n, p in baseline.pressures.items() if p < 0},
        "provenance": {"pressures_and_flows": "simulated", "areas": "assumed", "timing": "measured"},
        "rows": rows,
    }
    destination = output or settings.net_file.parent / "calibration.json"
    destination.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
    print("| Junction | Size | Area m2 (assumed) | Drop m (simulated) | Flow L/s (simulated) |")
    print("|---|---|---:|---:|---:|")
    for row in rows:
        if row.get("failed"):
            print(f"| {row['node']} | {row['size']} | solver failure | — | — |")
        else:
            print(f"| {row['node']} | {row['size']} | {row['effective_area_m2']:.6g} | "
                  f"{row['local_drop_m']:.3f} | {row['leak_flow_lps']:.3f} |")
    return artifact


if __name__ == "__main__":
    calibrate()
