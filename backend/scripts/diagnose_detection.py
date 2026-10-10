"""Validation-only diagnostics; never read the reserved final test seeds."""

import json

import networkx as nx
import numpy as np

from app.core.config import Settings
from app.detection.scenarios import ScenarioGenerator
from app.detection.service import Detector
from app.hydraulics.service import HydraulicService
from app.hydraulics.signatures import SignatureLibrary


def farthest(graph, eligible, k, weighted):
    chosen = [eligible[0]]
    while len(chosen) < k:
        distances = [nx.single_source_dijkstra_path_length(graph, node,
                     weight="weight" if weighted else None) for node in chosen]
        remaining = [node for node in eligible if node not in chosen]
        chosen.append(max(remaining, key=lambda n: min(d.get(n, float("inf")) for d in distances)))
    return chosen


def main():
    settings = Settings(_env_file=None)
    hydraulics = HydraulicService(settings)
    signatures = SignatureLibrary(settings, hydraulics)
    signatures.load()
    generator = ScenarioGenerator(settings, hydraulics, signatures)
    scenarios = [generator.make(seed) for seed in range(50)]
    baseline = hydraulics.run()
    eligible = [node for node in hydraulics.candidate_nodes() if baseline.pressures[node] > 0]
    experiments = {
        "weighted6": farthest(hydraulics.graph(), eligible, 6, True),
        "weighted10": farthest(hydraulics.graph(), eligible, 10, True),
        "hops6": farthest(hydraulics.graph(), eligible, 6, False),
        "screened_weighted6": farthest(hydraulics.graph(), [n for n in eligible if
            n not in {"20", "40", "50", "60", "61", "601"}], 6, True),
    }
    rows = []
    for label, sensors in experiments.items():
        for mode in ("raw", "centered", "demand_projected"):
            centered = mode == "centered"
            configured = settings.model_copy(update={"center_residuals": centered,
                                                     "demand_projection": mode == "demand_projected"})
            detector = Detector(configured, hydraulics, signatures, generator)
            hits, hits10, norms = 0, 0, []
            for seed, (stored, truth) in enumerate(scenarios):
                observation = generator.make_no_leak(seed, "mid", sensors=sensors)
                observation.pressures_all = stored.pressures_all
                observation.readings = generator.observe(stored.pressures_all, sensors, .2, seed)
                result = detector.analyze(observation)
                hit = truth.true_leak_node in [c.node for c in result.response.candidates[:3]]
                hits += hit
                hits10 += hit if seed < 10 else 0
                norms.append(result.response.evidence.residual_norm)
            row = {"sensors": sensors, "method": label, "transform": mode,
                   "top3_50": hits, "top3_10": hits10, "leak_norm_median": float(np.median(norms)),
                   "noise_floor": result.response.evidence.noise_floor}
            rows.append(row)
            print(json.dumps(row), flush=True)
    (settings.net_file.parent / "detector_diagnostics.json").write_text(
        json.dumps({"validation_seeds": [0, 49], "rows": rows}, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
