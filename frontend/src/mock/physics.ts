// Mock hydraulics: a cheap, deterministic surrogate for the WNTR backend, built on the real Net3
// topology. It is NOT physics-accurate; it exists so the UI can be demoed end to end without the
// backend, with the same qualitative behaviour (neighbours near-tie, sources damp the signal,
// demand drift contaminates residuals, sensor noise, offline sensors).
import net3 from "./data/net3.json";
import { Graph } from "../lib/graph";
import { gaussian, hashString, rng } from "../lib/rng";
import type { LeakSize, NetNode, NetPipe, NodeId, NoiseLevel } from "../contracts/types";

// Mirrors backend/config.py so mock and real scenarios speak the same language.
export const LEAK_AREAS_M2: Record<LeakSize, number> = { small: 2e-4, medium: 5e-4, large: 1e-3 };
export const REFERENCE_SIZE: LeakSize = "medium";
export const DISCHARGE_COEFF = 0.75;
export const NOISE_SIGMA_M: Record<NoiseLevel, number> = { low: 0.05, mid: 0.2, high: 0.5 };
export const DEMAND_MULT_RANGE: [number, number] = [0.9, 1.1];
export const DEFAULT_SENSORS_K = 6;
export const MISS_PROB = 0.05;
export const MAX_AGENT_STEPS = 6;

// Surrogate tuning (mock only).
const DECAY_M = 4000; // how far a leak's pressure drop travels along pipes
const SOURCE_DAMP_M = 250; // fixed-head nodes (reservoirs/tanks) pin pressure nearby
const REF_DROP_M = 6; // pressure drop at the leak node for the reference size
const DEMAND_SENSITIVITY_M = 9; // pressure shift per unit of demand multiplier drift
const SENSOR_DROPOUT = 0.03; // chance a sensor reports null
const G = 9.81;

export interface Net {
  nodes: NetNode[];
  pipes: NetPipe[];
  graph: Graph;
  nodeIndex: Map<NodeId, number>;
  /** Junction ids only: reservoirs and tanks carry no signal and are never candidates. */
  candidates: NodeId[];
  baseline: Float64Array; // P0 per node index (m)
  /** signature[c][n]: pressure change at node n for a REFERENCE_SIZE leak at candidate c. */
  signature: Map<NodeId, Float64Array>;
  referenceFlowLps: Map<NodeId, number>;
  demandShape: Float64Array; // per-node response to demand drift
  hopsFrom: (id: NodeId) => Map<NodeId, number>;
}

function sizeFactor(size: LeakSize): number {
  // Orifice flow scales with area; the pressure drop scales roughly with flow.
  return LEAK_AREAS_M2[size] / LEAK_AREAS_M2[REFERENCE_SIZE];
}

let cached: Net | null = null;

export function loadNet(): Net {
  if (cached) return cached;
  const nodes = net3.nodes as NetNode[];
  const pipes = net3.pipes.map(({ id, from, to, length, kind }) => ({ id, from, to, length, kind })) as NetPipe[];
  const elevation = net3.elevation as Record<string, number>;
  const graph = new Graph(
    nodes.map((n) => n.id),
    pipes,
  );
  const nodeIndex = new Map(nodes.map((n, i) => [n.id, i]));
  const candidates = nodes.filter((n) => n.type === "junction").map((n) => n.id);
  const sources = nodes.filter((n) => n.type !== "junction").map((n) => n.id);

  const dist = new Map<NodeId, Map<NodeId, number>>();
  for (const n of nodes) dist.set(n.id, graph.dijkstra(n.id).dist);

  // Distance to the nearest fixed-head node controls how much a node's pressure can move.
  const damp = new Float64Array(nodes.length);
  const distToSource = new Float64Array(nodes.length);
  nodes.forEach((n, i) => {
    const d = Math.min(...sources.map((s) => dist.get(s)!.get(n.id) ?? Infinity));
    distToSource[i] = d;
    damp[i] = n.type === "junction" ? 1 - Math.exp(-d / SOURCE_DAMP_M) : 0;
  });

  // Per-node susceptibility jitter breaks perfect symmetry, like real pipe diameters do.
  const jitter = nodes.map((n) => 0.8 + 0.4 * ((hashString(n.id) % 1000) / 1000));

  const topHead = Math.max(...sources.map((s) => elevation[s]));
  const baseline = new Float64Array(nodes.length);
  nodes.forEach((n, i) => {
    const head = topHead - 0.0012 * Math.min(distToSource[i], 20000);
    baseline[i] = n.type === "junction" ? Math.min(95, Math.max(18, head - elevation[n.id])) : 0;
  });

  const signature = new Map<NodeId, Float64Array>();
  const referenceFlowLps = new Map<NodeId, number>();
  for (const c of candidates) {
    const ci = nodeIndex.get(c)!;
    const dc = dist.get(c)!;
    const amp = REF_DROP_M * (0.35 + 0.65 * damp[ci]);
    const col = new Float64Array(nodes.length);
    nodes.forEach((n, i) => {
      const d = dc.get(n.id) ?? Infinity;
      col[i] = -amp * Math.exp(-d / DECAY_M) * damp[i] * jitter[i];
    });
    signature.set(c, col);
    const area = LEAK_AREAS_M2[REFERENCE_SIZE];
    referenceFlowLps.set(c, DISCHARGE_COEFF * area * Math.sqrt(2 * G * baseline[ci]) * 1000);
  }

  const demandShape = new Float64Array(nodes.length);
  nodes.forEach((_, i) => {
    demandShape[i] = -DEMAND_SENSITIVITY_M * damp[i] * (0.7 + 0.3 * Math.min(1, distToSource[i] / 4000));
  });

  const hopCache = new Map<NodeId, Map<NodeId, number>>();
  const hopsFrom = (id: NodeId) => {
    if (!hopCache.has(id)) hopCache.set(id, graph.hops(id));
    return hopCache.get(id)!;
  };

  cached = { nodes, pipes, graph, nodeIndex, candidates, baseline, signature, referenceFlowLps, demandShape, hopsFrom };
  return cached;
}

/** Farthest-point sampling by hop distance over junctions: deterministic, spread-out sensors. */
export function defaultSensors(net: Net, k: number = DEFAULT_SENSORS_K): NodeId[] {
  const pool = net.candidates;
  const kk = Math.max(1, Math.min(k, pool.length));
  // Start from the junction farthest from everything on average (graph periphery is informative).
  const first = pool.reduce((best, id) => {
    const h = net.hopsFrom(id);
    const sum = pool.reduce((s, o) => s + (h.get(o) ?? 0), 0);
    return sum > best.sum ? { id, sum } : best;
  }, { id: pool[0], sum: -1 }).id;
  const chosen = [first];
  while (chosen.length < kk) {
    let best = pool[0];
    let bestD = -1;
    for (const id of pool) {
      if (chosen.includes(id)) continue;
      const d = Math.min(...chosen.map((s) => net.hopsFrom(s).get(id) ?? Infinity));
      if (d > bestD) {
        bestD = d;
        best = id;
      }
    }
    chosen.push(best);
  }
  return chosen;
}

export interface SimulatedScenario {
  seed: number;
  trueLeakNode: NodeId | null;
  trueSize: LeakSize | null;
  demandMult: number;
  noiseLevel: NoiseLevel;
  noiseSigma: number;
  /** Noise-free pressures at every node (kept so sensors can change without re-simulating). */
  pressuresAll: Float64Array;
}

const SIZES: LeakSize[] = ["small", "medium", "large"];

export function simulate(
  net: Net,
  seed: number,
  opts: { size?: LeakSize; noise?: NoiseLevel; leak?: boolean } = {},
): SimulatedScenario {
  const rand = rng(seed * 7919 + 17);
  const leak = opts.leak ?? true;
  const trueLeakNode = leak ? net.candidates[Math.floor(rand() * net.candidates.length)] : null;
  const pickedSize = SIZES[Math.floor(rand() * SIZES.length)];
  const trueSize = leak ? (opts.size ?? pickedSize) : null;
  const [lo, hi] = DEMAND_MULT_RANGE;
  const demandMult = lo + (hi - lo) * rand();
  const noiseLevel = opts.noise ?? "mid";

  const p = Float64Array.from(net.baseline);
  for (let i = 0; i < p.length; i++) p[i] += (demandMult - 1) * net.demandShape[i];
  if (trueLeakNode && trueSize) {
    const s = net.signature.get(trueLeakNode)!;
    const f = sizeFactor(trueSize);
    for (let i = 0; i < p.length; i++) p[i] += f * s[i];
  }
  return { seed, trueLeakNode, trueSize, demandMult, noiseLevel, noiseSigma: NOISE_SIGMA_M[noiseLevel], pressuresAll: p };
}

/** Sensor readings with Gaussian noise and rare dropout (null). Seeded and reproducible. */
export function observe(net: Net, sc: SimulatedScenario, sensors: NodeId[], dropout = SENSOR_DROPOUT): Record<NodeId, number | null> {
  const rand = rng(sc.seed * 104729 + sensors.length);
  const out: Record<NodeId, number | null> = {};
  for (const id of sensors) {
    const noise = gaussian(rand) * sc.noiseSigma;
    const off = rand() < dropout;
    const v = sc.pressuresAll[net.nodeIndex.get(id)!] + noise;
    out[id] = off ? null : Math.round(v * 1000) / 1000;
  }
  return out;
}
