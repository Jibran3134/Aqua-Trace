"""Principle #2: the true leak is ONLY returned by GET /scenario/{id}/reveal.

We walk the whole investigation (leak -> detect -> agent -> "nothing found" ->
detect -> agent) and scan every response structurally. We do NOT grep for the
node id as a substring: the true node can legitimately show up as a candidate.
"""

from __future__ import annotations

import os

import pytest

from conftest import new_scenario

SEED_COUNT = int(os.environ.get("LEAK_SEEDS", "20"))
SEEDS = list(range(2000, 2000 + SEED_COUNT))

# Keys that only the reveal endpoint may ever emit.
FORBIDDEN_KEYS = {
    "true_leak_node", "true_size", "rank_of_truth", "hop_error_top1",
    "truth", "ground_truth", "true_node", "leak_node", "leak_area", "leak_size",
    "true_leak", "demand_mult",
}
LEAK_RESPONSE_KEYS = {"scenario_id", "seed", "sensors", "readings", "meta"}
LEAK_META_KEYS = {"time_step", "noise_sigma", "noise_level", "demand_mult_known"}
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

    leak = new_scenario(client, seed)
    sid = leak["scenario_id"]
    problems += leaked_keys("/scenario/leak", leak)

    # The scenario response is an allowlist: anything new must be reviewed on purpose.
    extra = set(leak) - LEAK_RESPONSE_KEYS
    extra_meta = set(leak.get("meta", {})) - LEAK_META_KEYS
    if extra:
        problems.append(f"/scenario/leak has unexpected top-level keys {sorted(extra)}")
    if extra_meta:
        problems.append(f"/scenario/leak.meta has unexpected keys {sorted(extra_meta)}")
    # Leak size must not be echoed back as a value either.
    for p, _, v in walk(leak):
        if isinstance(v, str) and v in SIZE_WORDS:
            problems.append(f"/scenario/leak {p} exposes a leak size word '{v}'")

    responses = []
    d1 = client.post("/detect", json={"scenario_id": sid})
    assert d1.status_code == 200, d1.text
    responses.append(("/detect", d1.json()))

    a1 = client.post("/agent/step", json={"scenario_id": sid, "mode": "scripted"})
    assert a1.status_code == 200, a1.text
    responses.append(("/agent/step", a1.json()))

    rec = a1.json().get("recommended_node")
    if rec and a1.json().get("state") == "investigating":
        f = client.post("/field/result", json={"scenario_id": sid, "node": rec, "found": False})
        assert f.status_code == 200, f.text
        responses.append(("/field/result", f.json()))
        d2 = client.post("/detect", json={"scenario_id": sid})
        responses.append(("/detect#2", d2.json()))
        a2 = client.post("/agent/step", json={"scenario_id": sid, "mode": "scripted"})
        responses.append(("/agent/step#2", a2.json()))

    # v1.1 /field/inspect reads the hidden truth to decide `found`, so it is the
    # likeliest place for truth to escape. A crew learns leak/no-leak AT THAT NODE
    # and nothing more.
    insp = client.post("/field/inspect", json={"scenario_id": sid, "node": leak["sensors"][0]})
    if insp.status_code == 200:
        body = insp.json()
        responses.append(("/field/inspect", body))
        allowed = {"node", "found", "state", "ranking", "note"}
        if set(body) - allowed:
            problems.append(f"/field/inspect has unexpected keys {sorted(set(body) - allowed)}")
        if body.get("node") != leak["sensors"][0]:
            problems.append("/field/inspect echoed a different node than the one inspected")

    for label, body in responses:
        problems += leaked_keys(label, body)

    assert not problems, f"seed {seed} leaked ground truth before reveal:\n  " + "\n  ".join(problems)

    # Sanity: reveal itself still works (otherwise this test proves nothing).
    rv = client.get(f"/scenario/{sid}/reveal")
    assert rv.status_code == 200 and "true_leak_node" in rv.json()


def test_error_bodies_never_contain_truth(client):
    sid = new_scenario(client, 31337)["scenario_id"]
    bad = [
        client.post("/field/result", json={"scenario_id": sid, "node": "does-not-exist", "found": False}),
        client.post("/detect", json={"scenario_id": "nope"}),
    ]
    for r in bad:
        assert not leaked_keys("error", r.json())
