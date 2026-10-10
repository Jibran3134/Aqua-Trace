// Detector mirroring backend task T3: least-squares fit of each candidate's signature to the observed
// residual at live sensors, softmax(-err / tau) into relative scores, gated by a noise floor.
import type { Candidate, DetectResponse, NodeId, NoiseLevel } from "../contracts/types";
import { type Net, observe, simulate } from "./physics";

export const CENTER_RESIDUALS = true;
const TAU_PER_SENSOR_VAR = 0.25; // tau = this * sigma^2 * live sensors (mock-tuned: sharper scores, same ranking)
const TOP_K = 10;
const TIE_TOLERANCE = 0.01;

function center(v: number[]): number[] {
  if (!CENTER_RESIDUALS || v.length === 0) return v;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  return v.map((x) => x - mean);
}

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const norm = (a: number[]) => Math.sqrt(dot(a, a));

export interface Fit {
  node: NodeId;
  err: number;
  alpha: number;
  predicted: number[];
}

export interface DetectInternals {
  live: NodeId[];
  residual: number[];
  fits: Map<NodeId, Fit>;
  /** Raw (pre-posterior) relative scores over all candidates. */
  likelihood: Map<NodeId, number>;
}

export function liveSensors(readings: Record<NodeId, number | null>): NodeId[] {
  return Object.keys(readings).filter((id) => readings[id] !== null && Number.isFinite(readings[id]));
}

export function residualAt(net: Net, readings: Record<NodeId, number | null>, live: NodeId[]): number[] {
  return center(live.map((id) => (readings[id] as number) - net.baseline[net.nodeIndex.get(id)!]));
}

export function fitAll(net: Net, readings: Record<NodeId, number | null>, sigma: number): DetectInternals {
  const live = liveSensors(readings);
  const residual = residualAt(net, readings, live);
  const fits = new Map<NodeId, Fit>();
  for (const c of net.candidates) {
    const col = net.signature.get(c)!;
    const s = center(live.map((id) => col[net.nodeIndex.get(id)!]));
    const alpha = Math.max(0, dot(s, residual) / (dot(s, s) + 1e-12));
    const predicted = s.map((x) => alpha * x);
    const err = residual.reduce((acc, r, i) => acc + (r - predicted[i]) ** 2, 0);
    fits.set(c, { node: c, err, alpha, predicted });
  }
  const tau = Math.max(1e-3, TAU_PER_SENSOR_VAR * sigma * sigma * Math.max(1, live.length));
  const minErr = Math.min(...[...fits.values()].map((f) => f.err));
  const raw = new Map<NodeId, number>();
  let total = 0;
  for (const f of fits.values()) {
    const w = Math.exp(-(f.err - minErr) / tau);
    raw.set(f.node, w);
    total += w;
  }
  for (const [k, v] of raw) raw.set(k, v / total);
  return { live, residual, fits, likelihood: raw };
}

/** Combines likelihood with posterior weights from field feedback and renormalizes. */
export function posteriorScores(likelihood: Map<NodeId, number>, weights: Map<NodeId, number>): Map<NodeId, number> {
  const out = new Map<NodeId, number>();
  let total = 0;
  for (const [k, v] of likelihood) {
    const w = v * (weights.get(k) ?? 1);
    out.set(k, w);
    total += w;
  }
  if (total <= 1e-300) return new Map(likelihood);
  for (const [k, v] of out) out.set(k, v / total);
  return out;
}

export function ranked(scores: Map<NodeId, number>): { node: NodeId; score: number }[] {
  return [...scores.entries()].map(([node, score]) => ({ node, score })).sort((a, b) => b.score - a.score || a.node.localeCompare(b.node));
}

/** Noise floor: 95th percentile of the centered residual norm over 30 no-leak scenarios. */
const floorCache = new Map<string, number>();
export function noiseFloor(net: Net, sensors: NodeId[], noise: NoiseLevel): number {
  const key = `${noise}|${[...sensors].sort().join(",")}`;
  const hit = floorCache.get(key);
  if (hit !== undefined) return hit;
  const norms: number[] = [];
  for (let seed = 50_000; seed < 50_030; seed++) {
    const sc = simulate(net, seed, { leak: false, noise });
    const readings = observe(net, sc, sensors, 0);
    norms.push(norm(residualAt(net, readings, liveSensors(readings))));
  }
  norms.sort((a, b) => a - b);
  const floor = norms[Math.floor(0.95 * (norms.length - 1))];
  floorCache.set(key, floor);
  return floor;
}

export function bestSensorToAdd(net: Net, a: NodeId, b: NodeId, existing: NodeId[]): NodeId | null {
  const sa = net.signature.get(a)!;
  const sb = net.signature.get(b)!;
  let best: NodeId | null = null;
  let bestGap = -1;
  for (const id of net.candidates) {
    if (existing.includes(id)) continue;
    const i = net.nodeIndex.get(id)!;
    const gap = Math.abs(sa[i] - sb[i]);
    if (gap > bestGap) {
      bestGap = gap;
      best = id;
    }
  }
  return best;
}

export function detect(
  net: Net,
  readings: Record<NodeId, number | null>,
  sensors: NodeId[],
  noise: NoiseLevel,
  sigma: number,
  weights: Map<NodeId, number> = new Map(),
): { response: DetectResponse; internals: DetectInternals } {
  const internals = fitAll(net, readings, sigma);
  const scores = posteriorScores(internals.likelihood, weights);
  const order = ranked(scores);
  const floor = noiseFloor(net, sensors, noise);
  const residualNorm = norm(internals.residual);
  const top = order.slice(0, TOP_K);

  let group = 0;
  const tieGroup = new Map<NodeId, number>();
  for (let i = 1; i < top.length; i++) {
    const prev = top[i - 1];
    const cur = top[i];
    if (prev.score > 0 && (prev.score - cur.score) / prev.score <= TIE_TOLERANCE) {
      if (!tieGroup.has(prev.node)) tieGroup.set(prev.node, ++group);
      tieGroup.set(cur.node, tieGroup.get(prev.node)!);
    }
  }

  const candidates: Candidate[] = top.map(({ node, score }) => ({
    node,
    score: round(score, 4),
    adjacent_pipes: net.graph.adjacentPipes(node),
    est_leak_lps: round(internals.fits.get(node)!.alpha * net.referenceFlowLps.get(node)!, 2),
    tie_group: tieGroup.get(node) ?? null,
  }));

  const live = internals.live.length;
  let note: string | null = null;
  if (live < 2) note = live === 0 ? "No live sensors: every sensor is offline." : "Only one live sensor: a location cannot be triangulated.";
  else if (residualNorm < floor) note = "Residual is below the noise floor: no leak signal stands out from demand drift and sensor noise.";
  const status = note ? "insufficient_evidence" : "ok";
  const margin = top.length > 1 && top[1].score > 0 ? top[0].score / top[1].score : top.length ? Infinity : 0;

  return {
    internals,
    response: {
      status,
      candidates: status === "ok" ? candidates : candidates.slice(0, 3),
      evidence: {
        residual_norm: round(residualNorm, 3),
        noise_floor: round(floor, 3),
        margin_top1_vs_top2: Number.isFinite(margin) ? round(margin, 3) : 999,
        live_sensors: live,
      },
      note,
      recommended_sensor:
        status === "insufficient_evidence" && top.length > 1 ? bestSensorToAdd(net, top[0].node, top[1].node, sensors) : null,
    },
  };
}

/** Naive baseline: rank candidates by graph distance to the sensor with the largest pressure drop. */
export function naiveRanking(net: Net, readings: Record<NodeId, number | null>): NodeId[] {
  const live = liveSensors(readings);
  if (!live.length) return [...net.candidates];
  const drops = live.map((id) => ({ id, drop: net.baseline[net.nodeIndex.get(id)!] - (readings[id] as number) }));
  const worst = drops.sort((a, b) => b.drop - a.drop)[0].id;
  const { dist } = net.graph.dijkstra(worst);
  return [...net.candidates].sort((a, b) => (dist.get(a) ?? Infinity) - (dist.get(b) ?? Infinity));
}

export function round(x: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}
