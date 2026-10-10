"""Principle #2: the true leak is ONLY returned by GET /scenario/{id}/reveal.

We walk the whole investigation and scan every response structurally. We do NOT
grep for the node id as a substring: the true node can legitimately appear as a
candidate, which is the point of the detector.

Endpoints that are not mounted yet are recorded as skipped-parts rather than
failures, so this stays useful while the backend is still being wired.
"""

from __future__ import annotations

import os

import pytest

from conftest import new_scenario, route_missing

SEED_COUNT = int(os.environ.get("LEAK_SEEDS", "8"))
SEEDS = list(range(2000, 2000 + SEED_COUNT))

# Keys that only the reveal endpoint may ever emit.
FORBIDDEN_KEYS = {
    "true_leak_node", "true_size", "rank_of_truth", "hop_error_top1",
    "truth", "ground_truth", "true_node", "leak_node", "leak_area", "leak_size",
    "true_leak", "demand_mult",
}
LEAK_RESPONSE_KEYS = {"scenario_id", "seed", "sensors", "readings", "meta", "provenance"}
# `provenance` holds the backend's measured/simulated/assumed labels, which is the
# honesty requirement, not a leak. Its free text is exempt from the size-word scan.
LEAK_META_KEYS = {"time_step", "noise_sigma", "noise_level", "demand_mult_known", "provenance"}
SIZE_WORDS = {"small", "medium", "large"}


def walk(obj, path="$"):
    """Yield (path, key, value) for every dict entry and (path, None, value) for list items."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield f"{path}.{k}", k, v
            yield from walk(v, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield f"{path}[{i}]", None, v
            yield from walk(v, f"{path}[{i}]")


def leaked_keys(label: str, body) -> list[str]:
    return [f"{label} {p}" for p, k, _ in walk(body) if k in FORBIDDEN_KEYS]


@pytest.mark.parametrize("seed", SEEDS)
def test_truth_is_absent_until_reveal(client, seed):
    problems: list[str] = []
    checked: list[str] = []

    leak = new_scenario(client, seed)
    sid = leak["scenario_id"]
    checked.append("/scenario/leak")
    problems += leaked_keys("/scenario/leak", leak)

    # The scenario response is an allowlist: anything new must be reviewed on purpose.
    extra = set(leak) - LEAK_RESPONSE_KEYS
    extra_meta = set(leak.get("meta", {})) - LEAK_META_KEYS
    if extra:
        problems.append(f"/scenario/leak has unexpected top-level keys {sorted(extra)}")
    if extra_meta:
        problems.append(f"/scenario/leak.meta has unexpected keys {sorted(extra_meta)}")
    # The leak size must not be echoed back as a value either.
    for p, _, v in walk(leak):
        if ".provenance" in p:
            continue
        if isinstance(v, str) and v in SIZE_WORDS:
            problems.append(f"/scenario/leak {p} exposes a leak size word '{v}'")

    d1 = client.post("/detect", json={"scenario_id": sid})
    assert d1.status_code == 200, d1.text
    problems += leaked_keys("/detect", d1.json())
    checked.append("/detect")
    top = (d1.json().get("candidates") or [{}])[0].get("node")

    a1 = client.post("/agent/step", json={"scenario_id": sid, "mode": "scripted"})
    if a1.status_code == 200:
        problems += leaked_keys("/agent/step", a1.json())
        checked.append("/agent/step")
        rec = a1.json().get("recommended_node")
        if rec and a1.json().get("state") == "investigating":
            f = client.post("/field/result", json={"scenario_id": sid, "node": rec, "found": False})
            if f.status_code == 200:
                problems += leaked_keys("/field/result", f.json())
                checked.append("/field/result")
                problems += leaked_keys("/detect#2", client.post("/detect", json={"scenario_id": sid}).json())
                a2 = client.post("/agent/step", json={"scenario_id": sid, "mode": "scripted"})
                if a2.status_code == 200:
                    problems += leaked_keys("/agent/step#2", a2.json())
            elif not route_missing(f):
                problems.append(f"/field/result -> {f.status_code}: {f.text[:200]}")
    elif not route_missing(a1):
        problems.append(f"/agent/step -> {a1.status_code}: {a1.text[:200]}")

    # v1.1 /field/inspect reads the hidden truth to decide `found`, so it is the
    # likeliest place for truth to escape. A crew learns leak/no-leak AT THAT NODE
    # and nothing more.
    if top:
        insp = client.post("/field/inspect", json={"scenario_id": sid, "node": top})
        if insp.status_code == 200:
            body = insp.json()
            problems += leaked_keys("/field/inspect", body)
            checked.append("/field/inspect")
            allowed = {"node", "found", "state", "ranking", "note"}
            if set(body) - allowed:
                problems.append(f"/field/inspect has unexpected keys {sorted(set(body) - allowed)}")
            if body.get("node") != top:
                problems.append("/field/inspect echoed a different node than the one inspected")
        elif not route_missing(insp):
            problems.append(f"/field/inspect -> {insp.status_code}: {insp.text[:200]}")

    assert not problems, f"seed {seed} leaked ground truth before reveal:\n  " + "\n  ".join(problems)

    # Sanity: reveal itself still works, otherwise this test proves nothing.
    rv = client.get(f"/scenario/{sid}/reveal")
    assert rv.status_code == 200, rv.text
    assert "true_leak_node" in rv.json(), "reveal must return the truth"
    assert len(checked) >= 2, f"too few endpoints exercised to be meaningful: {checked}"


def test_error_bodies_never_contain_truth(client):
    sid = new_scenario(client, 31337)["scenario_id"]
    bad = [
        client.post("/field/result", json={"scenario_id": sid, "node": "does-not-exist", "found": False}),
        client.post("/detect", json={"scenario_id": "nope"}),
        client.get("/scenario/nope/reveal"),
    ]
    for r in bad:
        assert not leaked_keys(f"error({r.status_code})", r.json())
