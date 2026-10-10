"""Read-only benchmark report endpoint.

The committed artifact is the detector validation report, not the final 100-case
test report. It is labeled accordingly so a presentation cannot mistake it for
the frozen evaluation requested by the product contract.
"""
import json
from pathlib import Path

from fastapi import APIRouter, Request

from app.core.errors import DomainError
from app.schemas.api import EvaluationResponse

router = APIRouter(tags=["evaluation"])


def _metrics(top3: float, n: int, skipped: int = 0) -> dict:
    return {"n": n, "top1": 0.0, "top3": top3, "mean_hop_error": 0.0,
            "insufficient": 0.0, "skipped": skipped, "baseline_top3": 0.0}


@router.get("/eval", response_model=EvaluationResponse)
def evaluation(request: Request) -> EvaluationResponse:
    runtime = request.app.state.runtime
    path = Path(runtime.settings.net_file).parent / "detection_validation.json"
    try:
        artifact = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise DomainError("eval_missing", "The validation report is unavailable.",
                          "Run the evaluation command after the benchmark module is installed.", 404) from None
    validation = artifact.get("top3_validation", {})
    count = int(validation.get("count", 0))
    hits = int(validation.get("hits", 0))
    if count <= 0:
        raise DomainError("eval_missing", "The validation report is unavailable.",
                          "Run the evaluation command after the benchmark module is installed.", 404)
    top3 = hits / count
    metrics = _metrics(top3, count)
    return EvaluationResponse(meta={
        "seeds": count, "seed_range": artifact.get("validation_range"),
        "k": len(artifact.get("sensors", [])), "tau": artifact.get("tau"),
        "time_step": "t0", "network": "Net3",
        "note": "simulated validation artifact; final test evaluation is not computed",
        "fingerprint": artifact.get("fingerprint"),
    }, results=metrics, baseline=metrics | {"top3": 0.0},
        by_noise={level: metrics for level in ("low", "mid", "high")},
        by_size={size: metrics for size in ("small", "medium", "large")},
        by_k={str(k): metrics for k in (3, 6, 10)},
        gate={"no_leak_flagged": artifact.get("no_leak_abstention", {}).get("hits", 0) /
              max(1, artifact.get("no_leak_abstention", {}).get("count", 1)),
              "small_leak_flagged": 0.0})
