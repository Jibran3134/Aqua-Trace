"""Does the backend speak the contract in contracts/api.md (as captured by mocks/*.json)?"""

from __future__ import annotations

import json

import pytest

from conftest import MOCKS, VITE_ORIGIN, new_scenario
from shape import diff


def mock(name: str):
    return json.loads((MOCKS / f"{name}.json").read_text(encoding="utf-8"))


def assert_shape(actual, expected, what: str) -> None:
    errs = diff(actual, expected)
    assert not errs, f"{what} does not match the contract mock:\n  " + "\n  ".join(errs)


def assert_error_format(r, status: int, code: str | None = None) -> None:
    assert r.status_code == status, f"expected HTTP {status}, got {r.status_code}: {r.text}"
    body = r.json()
    assert set(body) == {"error"}, f"error body must be exactly {{error:{{...}}}}, got {body}"
    err = body["error"]
    for k in ("code", "message", "hint"):
        assert isinstance(err.get(k), str) and err[k], f"error.{k} missing/empty in {body}"
    if code:
        assert err["code"] == code


# ---------- read-only endpoints ----------

def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert_shape(r.json(), mock("health"), "/health")


def test_cors_for_vite_origin(client):
    r = client.get("/health", headers={"Origin": VITE_ORIGIN})
    assert r.headers.get("access-control-allow-origin") in (VITE_ORIGIN, "*")


def test_network_shape_and_integrity(client):
    r = client.get("/network")
    assert r.status_code == 200
    body = r.json()
    assert_shape(body, mock("network"), "/network")
    ids = {n["id"] for n in body["nodes"]}
    assert all(isinstance(i, str) for i in ids), "node ids must be strings"
    for p in body["pipes"]:
        assert p["from"] in ids and p["to"] in ids, f"pipe {p['id']} references unknown node"
    types = {n["id"]: n["type"] for n in body["nodes"]}
    assert set(types.values()) <= {"junction", "reservoir", "tank"}
    assert body["default_sensors"], "default_sensors is empty"
    assert all(types.get(s) == "junction" for s in body["default_sensors"]), "sensors must be junctions"


# ---------- scenario / detect / agent / field / reveal ----------

def test_scenario_leak_shape(client, network):
    body = new_scenario(client, 1015)
    assert_shape(body, mock("scenario_leak"), "/scenario/leak")
    assert set(body["readings"]) == set(body["sensors"]), "readings keys must equal sensors"
    node_ids = {n["id"] for n in network["nodes"]}
    assert set(body["sensors"]) <= node_ids
    assert body["meta"]["time_step"] == "t0"
    assert body["meta"]["demand_mult_known"] is False


def test_same_seed_gives_same_scenario(client):
    a, b = new_scenario(client, 4242), new_scenario(client, 4242)
    assert a["sensors"] == b["sensors"]
    assert a["readings"] == b["readings"], "same seed must reproduce identical readings"


def test_detect_shape_and_ranking(client):
    sid = new_scenario(client, 1016)["scenario_id"]
    r = client.post("/detect", json={"scenario_id": sid})
    assert r.status_code == 200, r.text
    body = r.json()
    assert_shape(body, mock("detect"), "/detect")
    assert body["status"] in ("ok", "insufficient_evidence")
    cands = body["candidates"]
    assert len(cands) <= 10
    scores = [c["score"] for c in cands]
    assert scores == sorted(scores, reverse=True), "candidates must be sorted by score desc"
    assert all(0.0 <= s <= 1.0 for s in scores)
    assert sum(scores) <= 1.0001, "relative scores should sum to <= 1"
    assert len({c["node"] for c in cands}) == len(cands), "duplicate candidate nodes"
    assert r.json() == client.post("/detect", json={"scenario_id": sid}).json(), \
        "detect must be a pure read: two calls, same answer"
    if body["status"] == "insufficient_evidence":
        assert body.get("note"), "insufficient_evidence needs a human-readable note"


def test_agent_step_shape(client, network):
    sid = new_scenario(client, 1017)["scenario_id"]
    r = client.post("/agent/step", json={"scenario_id": sid, "mode": "scripted"})
    assert r.status_code == 200, r.text
    body = r.json()

    expected = mock("agent_step")
    pool = [e for n in ("agent_step", "agent_step_abstain", "agent_step_resolved") for e in mock(n)["events"]]
    expected["events"] = pool
    assert_shape(body, expected, "/agent/step")

    assert body["source"] in ("llm", "scripted")
    assert body["state"] in ("investigating", "resolved", "abstained")
    assert body["events"], "agent returned no events"
    steps = [e["step"] for e in body["events"]]
    assert steps == sorted(steps), "event steps must be non-decreasing"
    allowed = {"thought", "tool_call", "tool_result", "recommendation", "abstain", "final"}
    assert {e["type"] for e in body["events"]} <= allowed
    node_ids = {n["id"] for n in network["nodes"]}
    if body.get("recommended_node"):
        assert body["recommended_node"] in node_ids, "recommended_node is not a real network node"
    assert set(body.get("route") or []) <= node_ids


def test_field_result_shape_and_idempotent(client):
    sid = new_scenario(client, 1018)["scenario_id"]
    top = client.post("/detect", json={"scenario_id": sid}).json()["candidates"][0]["node"]
    payload = {"scenario_id": sid, "node": top, "found": False}

    r1 = client.post("/field/result", json=payload)
    assert r1.status_code == 200, r1.text
    assert_shape(r1.json(), mock("field_result"), "/field/result")
    r2 = client.post("/field/result", json=payload)
    assert r2.json()["ranking"] == r1.json()["ranking"], "repeating a field report must change nothing"

    # Down-weighted, never zeroed.
    ranking = {x["node"]: x["score"] for x in r1.json()["ranking"]}
    if top in ranking:
        assert ranking[top] > 0, "a 'not found' report must not zero the node"


def test_reveal_shape(client, network):
    sid = new_scenario(client, 1019)["scenario_id"]
    r = client.get(f"/scenario/{sid}/reveal")
    assert r.status_code == 200, r.text
    body = r.json()
    assert_shape(body, mock("reveal"), "/reveal")
    assert body["true_leak_node"] in {n["id"] for n in network["nodes"]}
    assert body["rank_of_truth"] >= 1


# ---------- errors: the UI relies on {error:{code,message,hint}} ----------

@pytest.mark.parametrize("method,path,body", [
    ("POST", "/detect", {"scenario_id": "nope"}),
    ("POST", "/agent/step", {"scenario_id": "nope"}),
    ("POST", "/field/result", {"scenario_id": "nope", "node": "10", "found": False}),
    ("GET", "/scenario/nope/reveal", None),
])
def test_unknown_scenario_is_404_in_error_format(client, method, path, body):
    r = client.request(method, path, json=body) if body is not None else client.request(method, path)
    assert_error_format(r, 404, "scenario_not_found")


@pytest.mark.parametrize("body", [
    {"noise": "loud"},
    {"size": "huge"},
    {"k": 999},
    {"k": 0},
])
def test_bad_scenario_input_is_422_in_error_format(client, body):
    assert_error_format(client.post("/scenario/leak", json=body), 422, "validation_error")


def test_malformed_json_is_422_in_error_format(client):
    r = client.post("/detect", content="{not json", headers={"Content-Type": "application/json"})
    assert_error_format(r, 422, "validation_error")


def test_eval_is_valid_or_clean_404(client):
    r = client.get("/eval")
    if r.status_code == 200:
        body = r.json()
        for k in ("meta", "results", "baseline", "by_noise", "by_size", "by_k"):
            assert k in body, f"/eval missing {k}"
    else:
        assert_error_format(r, 404, "eval_missing")
