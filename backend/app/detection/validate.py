"""Reproduce frozen development acceptance without consuming final test seeds."""

import json
from time import perf_counter

from app.core.config import Settings
from app.detection.scenarios import ScenarioGenerator
from app.detection.service import Detector
from app.hydraulics.service import HydraulicService
from app.hydraulics.signatures import SignatureLibrary


def main() -> None:
    """Write public aggregate diagnostics only; no scenario truth is serialized."""
    started = perf_counter()
    settings = Settings()
    hydraulics = HydraulicService(settings)
    signatures = SignatureLibrary(settings, hydraulics)
    signatures.load()
    generator = ScenarioGenerator(settings, hydraulics, signatures)
    detector = Detector(settings, hydraulics, signatures, generator)
    hits = []
    for seed in range(50):
        observation, truth = generator.make(seed)
        result = detector.analyze(observation)
        hits.append(truth.true_leak_node in [c.node for c in result.response.candidates[:3]])
    abstentions = 0
    for seed in range(30000, 30030):
        result = detector.analyze(generator.make_no_leak(seed, "mid"))
        abstentions += result.response.status == "insufficient_evidence"
    artifact = {
        "validation_range": [0, 49], "acceptance_range": [0, 9],
        "heldout_no_leak_range": [30000, 30029],
        "top3_validation": {"hits": sum(hits), "count": 50},
        "top3_acceptance": {"hits": sum(hits[:10]), "count": 10},
        "no_leak_abstention": {"hits": abstentions, "count": 30},
        "sensors": hydraulics.default_sensors(6), "noise": "mid",
        "center_residuals": settings.center_residuals,
        "demand_projection": settings.demand_projection,
        "tau": settings.detector_tau, "noise_percentile": settings.noise_floor_percentile,
        "fingerprint": detector.fingerprint,
        "elapsed_seconds_measured": perf_counter() - started,
        "provenance": "simulated benchmark outcomes; measured validation duration",
        "note": "Frozen on validation only; final test seeds 1000-1099 are unused here.",
    }
    (settings.net_file.parent / "detection_validation.json").write_text(
        json.dumps(artifact, indent=2) + "\n", encoding="utf-8",
    )
    print(json.dumps(artifact, indent=2))


if __name__ == "__main__":
    main()
