// Agent tools (task T7) and the deterministic scripted investigator (task T8), mock edition.
// Every number and node id in the narrative comes from a tool result, never from free text.
import type { AgentEvent, AgentStepResponse, NodeId, ToolName } from "../contracts/types";
import { bestSensorToAdd, detect, posteriorScores, ranked, round } from "./detector";
import { MAX_AGENT_STEPS, MISS_PROB, type Net } from "./physics";
import type { ScenarioState } from "./state";

/** Mock threshold: abstain on the first turn when the top two candidates are this close. */
const ABSTAIN_MARGIN = 1.15;

export class ToolError extends Error {}

function assertCandidate(net: Net, node: unknown): NodeId {
  if (typeof node !== "string" || !net.signature.has(node)) {
    throw new ToolError(`unknown node ${String(node)}; valid examples: ${net.candidates.slice(0, 4).join(", ")}`);
  }
  return node;
}

export function currentRanking(net: Net, st: ScenarioState) {
  return ranked(posteriorScores(st.likelihood, st.weights)).filter((r) => net.signature.has(r.node));
}

// ---------- tools ----------

export function rankCandidates(net: Net, st: ScenarioState, topK = 3) {
  const k = Math.max(1, Math.min(10, Math.round(topK)));
  const { response } = detect(net, st.readings, st.sensors, st.sim.noiseLevel, st.sim.noiseSigma, st.weights);
  return {
    status: response.status,
    candidates: response.candidates.slice(0, k).map((c) => ({
      node: c.node,
      score: c.score,
      est_leak_lps: c.est_leak_lps,
      adjacent_pipes: c.adjacent_pipes,
      inspected: st.inspected.has(c.node),
    })),
    evidence: response.evidence,
    note: response.note ?? null,
  };
}

export function simulateHypothesis(net: Net, st: ScenarioState, node: unknown) {
  const id = assertCandidate(net, node);
  const fit = st.fits.get(id)!;
  const live = st.live;
  const per_sensor = live.map((sensor, i) => ({
    sensor,
    observed: round(st.residual[i], 3),
    predicted: round(fit.predicted[i], 3),
  }));
  const rmse = Math.sqrt(fit.err / Math.max(1, live.length));
  const fit_label = rmse < st.sim.noiseSigma * 1.5 ? "good" : rmse < st.sim.noiseSigma * 3 ? "fair" : "poor";
  return { node: id, per_sensor, rmse: round(rmse, 3), fit_label };
}

export function planInspection(net: Net, _st: ScenarioState, nodes: unknown) {
  if (!Array.isArray(nodes) || nodes.length === 0) throw new ToolError("nodes must be a non-empty list of node ids");
  const targets = [...new Set(nodes.map((n) => assertCandidate(net, n)))];
  const depot = depotNode(net);
  const order: NodeId[] = [];
  const legs: { from: NodeId; to: NodeId; length_m: number }[] = [];
  let at = depot;
  const left = new Set(targets);
  while (left.size) {
    const { dist } = net.graph.dijkstra(at);
    const next = [...left].sort((a, b) => (dist.get(a) ?? Infinity) - (dist.get(b) ?? Infinity))[0];
    legs.push({ from: at, to: next, length_m: Math.round(dist.get(next) ?? 0) });
    order.push(next);
    left.delete(next);
    at = next;
  }
  return { depot, order, total_length_m: legs.reduce((s, l) => s + l.length_m, 0), legs };
}

export function recordFieldResult(net: Net, st: ScenarioState, node: unknown, found: boolean) {
  const id = assertCandidate(net, node);
  if (found) {
    st.resolved = true;
    st.foundAt = id;
    if (!st.inspected.has(id)) st.inspectionOrder.push(id);
    st.inspected.add(id);
    return { closed: true, node: id };
  }
  if (st.inspected.has(id)) return { closed: false, node: id, note: "already reported; no change" };
  st.inspected.add(id);
  st.inspectionOrder.push(id);
  st.weights.set(id, (st.weights.get(id) ?? 1) * MISS_PROB);
  return { closed: false, node: id, ranking: currentRanking(net, st).slice(0, 5).map((r) => ({ node: r.node, score: round(r.score, 4) })) };
}

export function recommendSensorAddition(net: Net, st: ScenarioState) {
  const rank = currentRanking(net, st);
  const { response } = detect(net, st.readings, st.sensors, st.sim.noiseLevel, st.sim.noiseSigma, st.weights);
  const margin = response.evidence.margin_top1_vs_top2;
  if (response.status === "ok" && margin >= 2) {
    return { recommended: null, reason: `top candidate already separated (margin ${margin})` };
  }
  const node = bestSensorToAdd(net, rank[0].node, rank[1].node, st.sensors);
  return { recommended: node, separates: [rank[0].node, rank[1].node], reason: response.note ?? `top two candidates are close (margin ${margin})` };
}

export function depotNode(net: Net): NodeId {
  const reservoir = net.nodes.find((n) => n.type === "reservoir")!;
  const { dist } = net.graph.dijkstra(reservoir.id);
  return [...net.candidates].sort((a, b) => (dist.get(a) ?? Infinity) - (dist.get(b) ?? Infinity))[0];
}

// ---------- scripted investigator ----------

class Trace {
  events: AgentEvent[] = [];
  step = 0;
  thought(text: string) {
    this.step++;
    this.events.push({ step: this.step, type: "thought", text });
  }
  tool<T>(name: ToolName, args: Record<string, unknown>, run: () => T): T {
    this.events.push({ step: this.step, type: "tool_call", name, args });
    const result = run();
    this.events.push({ step: this.step, type: "tool_result", name, result });
    return result;
  }
  push(type: AgentEvent["type"], text: string) {
    this.step++;
    this.events.push({ step: this.step, type, text });
  }
}

export function scriptedStep(net: Net, st: ScenarioState): AgentStepResponse {
  const t = new Trace();
  const inspections = st.inspected.size;
  st.turns++;

  if (st.resolved && st.foundAt) {
    t.thought("The crew reported the leak. Summarizing the investigation from recorded results.");
    const plan = t.tool("plan_inspection", { nodes: [...st.inspectionOrder] }, () => planInspection(net, st, [...st.inspectionOrder]));
    t.push(
      "final",
      `Leak confirmed at node ${st.foundAt} after ${inspections} inspection${inspections === 1 ? "" : "s"}. ` +
        `Crew route covered ${plan.total_length_m} m from depot ${plan.depot}.`,
    );
    return { events: t.events, source: "scripted", recommended_node: st.foundAt, route: plan.order, route_length_m: plan.total_length_m, inspections_used: inspections, state: "resolved" };
  }

  t.thought(inspections ? `Re-ranking after ${inspections} field report${inspections === 1 ? "" : "s"}.` : "Ranking candidates from sensor residuals.");
  const rank = t.tool("rank_candidates", { top_k: 3 }, () => rankCandidates(net, st, 3));

  const margin = rank.evidence.margin_top1_vs_top2;
  const shouldAbstain = rank.status === "insufficient_evidence" || (inspections === 0 && margin < ABSTAIN_MARGIN);
  if (shouldAbstain || inspections >= MAX_AGENT_STEPS) {
    t.thought(
      inspections >= MAX_AGENT_STEPS
        ? "Inspection cap reached. Recommending more evidence instead of guessing further."
        : rank.status === "insufficient_evidence"
          ? "Evidence is insufficient. Asking where one more sensor would help most."
          : "Top candidates are too close to call. Asking where one more sensor would separate them.",
    );
    const rec = t.tool("recommend_sensor_addition", {}, () => recommendSensorAddition(net, st));
    const target = rec.recommended ?? null;
    t.push(
      "abstain",
      target ? `More evidence needed. Add a pressure sensor at node ${target}${"separates" in rec && rec.separates ? ` to separate ${rec.separates[0]} from ${rec.separates[1]}` : ""}.` : "More evidence needed before dispatching a crew.",
    );
    st.abstained = true;
    return { events: t.events, source: "scripted", recommended_node: target, route: [], inspections_used: inspections, state: "abstained" };
  }

  const open = currentRanking(net, st).filter((r) => !st.inspected.has(r.node));
  if (!open.length) {
    t.push("abstain", "Every candidate has been inspected. Recommend re-surveying with additional sensors.");
    return { events: t.events, source: "scripted", recommended_node: null, route: [], inspections_used: inspections, state: "abstained" };
  }
  const top = open.slice(0, 3).map((r) => r.node);

  t.thought(`Checking whether a leak at node ${top[0]} explains the sensor pattern.`);
  const hyp = t.tool("simulate_hypothesis", { node: top[0] }, () => simulateHypothesis(net, st, top[0]));

  t.thought("Planning the crew route through the leading candidates.");
  const plan = t.tool("plan_inspection", { nodes: top }, () => planInspection(net, st, top));
  const first = plan.order[0];

  t.push(
    "recommendation",
    `Inspect node ${first} first (route: ${plan.order.join(" → ")}, ${plan.total_length_m} m from depot ${plan.depot}). ` +
      `Hypothesis fit at ${hyp.node}: ${hyp.fit_label} (rmse ${hyp.rmse} m).`,
  );
  return { events: t.events, source: "scripted", recommended_node: first, route: plan.order, route_length_m: plan.total_length_m, inspections_used: inspections, state: "investigating" };
}
