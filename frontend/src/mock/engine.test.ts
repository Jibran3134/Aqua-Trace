import { describe, expect, it } from "vitest";
import type { AgentStepResponse, DetectResponse, ErrorBody, FieldResultResponse, NetworkResponse, RevealResponse, ScenarioResponse } from "../contracts/types";
import { MockBackend } from "./engine";

const call = <T>(b: MockBackend, method: string, path: string, body?: unknown) => {
  const r = b.handle(method, path, body);
  return { status: r.status, body: r.body as T };
};

function leakAndDetect(b: MockBackend, seed: number) {
  const leak = call<ScenarioResponse>(b, "POST", "/scenario/leak", { seed });
  const detect = call<DetectResponse>(b, "POST", "/detect", { scenario_id: leak.body.scenario_id });
  return { leak: leak.body, detect: detect.body };
}

describe("mock backend contract", () => {
  it("serves the real Net3 network with default sensors", () => {
    const { body } = call<NetworkResponse>(new MockBackend(), "GET", "/network");
    expect(body.nodes).toHaveLength(97);
    expect(body.pipes).toHaveLength(119);
    expect(body.default_sensors).toHaveLength(6);
    const junctions = new Set(body.nodes.filter((n) => n.type === "junction").map((n) => n.id));
    for (const s of body.default_sensors) expect(junctions.has(s)).toBe(true);
  });

  it("never returns the truth before reveal (structured check over 20 seeds)", () => {
    const b = new MockBackend();
    for (let seed = 1000; seed < 1020; seed++) {
      const { leak, detect } = leakAndDetect(b, seed);
      const agent = call<AgentStepResponse>(b, "POST", "/agent/step", { scenario_id: leak.scenario_id }).body;
      for (const payload of [leak, detect, agent]) {
        const json = JSON.stringify(payload);
        expect(json).not.toMatch(/true_leak|true_size|demand_mult"/);
      }
      expect(Object.keys(leak)).toEqual(["scenario_id", "seed", "sensors", "readings", "meta"]);
      const reveal = call<RevealResponse>(b, "GET", `/scenario/${leak.scenario_id}/reveal`).body;
      expect(typeof reveal.true_leak_node).toBe("string");
    }
  });

  it("same seed gives identical readings and detection", () => {
    const a = leakAndDetect(new MockBackend(), 1042);
    const c = leakAndDetect(new MockBackend(), 1042);
    expect(a.leak.readings).toEqual(c.leak.readings);
    expect(a.detect).toEqual(c.detect);
  });

  it("returns relative scores that are sorted and bounded", () => {
    const { detect } = leakAndDetect(new MockBackend(), 1003);
    const scores = detect.candidates.map((c) => c.score);
    expect([...scores].sort((x, y) => y - x)).toEqual(scores);
    for (const s of scores) expect(s).toBeGreaterThanOrEqual(0);
    expect(scores.reduce((s, x) => s + x, 0)).toBeLessThanOrEqual(1.0001);
  });

  it("finds the truth in the top 3 on most mid-noise seeds with k=10", () => {
    const b = new MockBackend();
    let hits = 0;
    for (let seed = 1000; seed < 1010; seed++) {
      const leak = call<ScenarioResponse>(b, "POST", "/scenario/leak", { seed, k: 10 }).body;
      const detect = call<DetectResponse>(b, "POST", "/detect", { scenario_id: leak.scenario_id }).body;
      const truth = call<RevealResponse>(b, "GET", `/scenario/${leak.scenario_id}/reveal`).body.true_leak_node;
      if (detect.candidates.slice(0, 3).some((c) => c.node === truth)) hits++;
    }
    expect(hits).toBeGreaterThanOrEqual(6);
  });

  it("down-weights (never zeroes) a node after 'nothing found', idempotently", () => {
    const b = new MockBackend();
    const { leak, detect } = leakAndDetect(b, 1005);
    const top = detect.candidates[0].node;
    const r1 = call<FieldResultResponse>(b, "POST", "/field/result", { scenario_id: leak.scenario_id, node: top, found: false }).body;
    expect(r1.ranking[0].node).not.toBe(top);
    const after = r1.ranking.find((r) => r.node === top);
    if (after) expect(after.score).toBeGreaterThan(0);
    const r2 = call<FieldResultResponse>(b, "POST", "/field/result", { scenario_id: leak.scenario_id, node: top, found: false }).body;
    expect(r2.ranking).toEqual(r1.ranking);
    expect(r2.note).toMatch(/already reported/);
  });

  it("runs the scripted investigation to a resolved final event", () => {
    const b = new MockBackend();
    const leak = call<ScenarioResponse>(b, "POST", "/scenario/leak", { seed: 1000, k: 10, noise: "low" }).body;
    const step1 = call<AgentStepResponse>(b, "POST", "/agent/step", { scenario_id: leak.scenario_id }).body;
    expect(step1.source).toBe("scripted");
    expect(step1.events[0].type).toBe("thought");
    expect(step1.events.some((e) => e.type === "tool_call" && e.name === "rank_candidates")).toBe(true);
    if (step1.state === "investigating") {
      call(b, "POST", "/field/result", { scenario_id: leak.scenario_id, node: step1.recommended_node, found: true });
      const step2 = call<AgentStepResponse>(b, "POST", "/agent/step", { scenario_id: leak.scenario_id }).body;
      expect(step2.state).toBe("resolved");
      expect(step2.events.at(-1)?.type).toBe("final");
    } else {
      expect(step1.events.at(-1)?.type).toBe("abstain");
    }
  });

  it("flags insufficient evidence when every sensor is offline-equivalent (1 sensor)", () => {
    const b = new MockBackend();
    const leak = call<ScenarioResponse>(b, "POST", "/scenario/leak", { seed: 7, sensors: ["15"] }).body;
    const detect = call<DetectResponse>(b, "POST", "/detect", { scenario_id: leak.scenario_id }).body;
    expect(detect.status).toBe("insufficient_evidence");
    expect(detect.note).toBeTruthy();
  });

  it("uses the contract error format", () => {
    const b = new MockBackend();
    const nf = call<ErrorBody>(b, "POST", "/detect", { scenario_id: "nope" });
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe("scenario_not_found");
    expect(nf.body.error.hint).toMatch(/simulate again/i);
    const bad = call<ErrorBody>(b, "POST", "/scenario/leak", { noise: "extreme" });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe("validation_error");
  });

  it("returns 503 while signatures are building", () => {
    const b = new MockBackend(60_000);
    expect(call<{ signatures_ready: boolean }>(b, "GET", "/health").body.signatures_ready).toBe(false);
    expect(call<ErrorBody>(b, "POST", "/scenario/leak", {}).status).toBe(503);
  });
});
