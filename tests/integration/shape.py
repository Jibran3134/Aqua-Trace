"""Structural diff of a real API response against a mock JSON.

Rules (kept deliberately loose so additive changes never break the build):
- Every key in the mock must exist in the response, unless it is in OPTIONAL
  (mirrors the `?` fields in frontend/src/contracts/types.ts).
- Extra keys in the response are fine.
- `null` on either side matches anything.
- int/float are one kind ("number"); bool is separate.
- Lists: each response element is compared to the mock element with the same
  `type` (agent events) or else the first mock element.
- OPAQUE keys (tool args/results) and MAP keys (node-id -> value) are not
  compared key by key.
"""

from __future__ import annotations

from typing import Any

OPTIONAL = {
    "progress", "kind", "seed", "noise_level", "tie_group", "live_sensors",
    "note", "recommended_sensor", "recommended_node", "route", "route_length_m",
    "inspections_used", "baseline_top3", "generated_at", "gate",
    "inspected",  # tool results carry it; not part of any response contract
}
OPAQUE = {"result", "args"}
MAPS = {"readings"}


def kind(v: Any) -> str:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, (int, float)):
        return "number"
    if isinstance(v, str):
        return "string"
    if isinstance(v, list):
        return "list"
    return "object"


def diff(actual: Any, mock: Any, path: str = "$", key: str = "") -> list[str]:
    """Return a list of human-readable mismatches (empty list = shapes agree)."""
    if actual is None or mock is None:
        return []
    ka, km = kind(actual), kind(mock)
    if ka != km:
        return [f"{path}: expected {km}, got {ka}"]
    if key in OPAQUE:
        return []

    errs: list[str] = []
    if ka == "object":
        if key in MAPS:
            sample = next(iter(mock.values()), None)
            for k, v in actual.items():
                errs += diff(v, sample, f"{path}.{k}")
            return errs
        for k, mv in mock.items():
            if k not in actual:
                if k not in OPTIONAL:
                    errs.append(f"{path}.{k}: missing")
                continue
            errs += diff(actual[k], mv, f"{path}.{k}", k)
    elif ka == "list" and mock and actual:
        for i, a in enumerate(actual):
            pool = mock[:1]
            if isinstance(a, dict) and "type" in a:
                pool = [m for m in mock if isinstance(m, dict) and m.get("type") == a["type"]] or pool
            errs += diff(a, pool[0], f"{path}[{i}]")
    return errs
