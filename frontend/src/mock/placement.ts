// Mock of backend task T12 (stretch S1): greedy sensor placement + accuracy-vs-k curve on validation
// seeds, compared with farthest-point sampling at equal k. Kept small: it exists to feed the UI.
import type { CurvePoint, NodeId, NoiseLevel, SensorPlaceResponse } from "../contracts/types";
import { detect, round } from "./detector";
import { defaultSensors, NOISE_SIGMA_M, type Net, observe, simulate } from "./physics";

const MAX_K = 12;
const VALIDATION_SEEDS = Array.from({ length: 40 }, (_, i) => i);

/** Adds, one at a time, the junction that makes the most candidate pairs distinguishable. */
function greedy(net: Net, noise: NoiseLevel, k: number): NodeId[] {
  const cands = net.candidates;
  const idx = cands.map((c) => net.nodeIndex.get(c)!);
  const sig = cands.map((c) => net.signature.get(c)!);
  const delta2 = (2 * (NOISE_SIGMA_M[noise] + 0.1)) ** 2; // 2 * sigma_eff, squared
  const pairs: [number, number][] = [];
  for (let a = 0; a < cands.length; a++) for (let b = a + 1; b < cands.length; b++) pairs.push([a, b]);
  const acc = new Float64Array(pairs.length);
  const chosen: number[] = [];
  while (chosen.length < k) {
    let best = -1;
    let bestCount = -1;
    for (let s = 0; s < cands.length; s++) {
      if (chosen.includes(s)) continue;
      const n = idx[s];
      let count = 0;
      for (let p = 0; p < pairs.length; p++) {
        const d = sig[pairs[p][0]][n] - sig[pairs[p][1]][n];
        if (acc[p] + d * d > delta2) count++;
      }
      if (count > bestCount) {
        bestCount = count;
        best = s;
      }
    }
    chosen.push(best);
    const n = idx[best];
    for (let p = 0; p < pairs.length; p++) {
      const d = sig[pairs[p][0]][n] - sig[pairs[p][1]][n];
      acc[p] += d * d;
    }
  }
  return chosen.map((i) => cands[i]);
}

function accuracy(net: Net, sensors: NodeId[], noise: NoiseLevel) {
  let t1 = 0;
  let t3 = 0;
  for (const seed of VALIDATION_SEEDS) {
    const sc = simulate(net, seed, { noise });
    const top = detect(net, observe(net, sc, sensors), sensors, noise, sc.noiseSigma).response.candidates.map((c) => c.node);
    if (top[0] === sc.trueLeakNode) t1++;
    if (top.slice(0, 3).includes(sc.trueLeakNode!)) t3++;
  }
  return { top1: round(t1 / VALIDATION_SEEDS.length, 3), top3: round(t3 / VALIDATION_SEEDS.length, 3) };
}

const cache = new Map<NoiseLevel, { order: NodeId[]; curve: CurvePoint[] }>();

export function placeSensors(net: Net, k: number, noise: NoiseLevel): SensorPlaceResponse {
  if (!cache.has(noise)) {
    const order = greedy(net, noise, MAX_K);
    const curve: CurvePoint[] = [];
    for (let kk = 1; kk <= MAX_K; kk++) {
      const g = accuracy(net, order.slice(0, kk), noise);
      curve.push({ k: kk, ...g, baseline_top3: accuracy(net, defaultSensors(net, kk), noise).top3 });
    }
    cache.set(noise, { order, curve });
  }
  const { order, curve } = cache.get(noise)!;
  // Greedy is nested (the k-sensor set extends the (k-1) set), so a prefix is the answer for any k.
  return { sensors: order.slice(0, Math.min(k, MAX_K)), curve };
}
