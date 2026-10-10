// Mock edition of backend task T11: evaluates the detector on held-out TEST seeds (1000-1099) with
// fixed seeds, against the naive "nearest to the biggest drop" baseline. Numbers describe the MOCK
// physics only; the UI badges them so they never reach a slide.
import type { EvalResponse, LeakSize, Metrics, NoiseLevel } from "../contracts/types";
import { detect, naiveRanking, round } from "./detector";
import { DEFAULT_SENSORS_K, defaultSensors, type Net, observe, simulate } from "./physics";

const TEST_SEEDS = Array.from({ length: 100 }, (_, i) => 1000 + i);
const NO_LEAK_SEEDS = Array.from({ length: 50 }, (_, i) => 60_000 + i);

interface Run {
  noise?: NoiseLevel;
  size?: LeakSize;
  k?: number;
}

function evaluate(net: Net, run: Run): { method: Metrics; baseline: Metrics } {
  const noise = run.noise ?? "mid";
  const sensors = defaultSensors(net, run.k ?? DEFAULT_SENSORS_K);
  let t1 = 0, t3 = 0, hops = 0, insufficient = 0;
  let b1 = 0, b3 = 0, bhops = 0;
  for (const seed of TEST_SEEDS) {
    const sc = simulate(net, seed, { noise, size: run.size });
    const readings = observe(net, sc, sensors);
    const truth = sc.trueLeakNode!;
    const { response } = detect(net, readings, sensors, noise, sc.noiseSigma);
    const ids = response.candidates.map((c) => c.node);
    if (response.status !== "ok") insufficient++;
    if (ids[0] === truth) t1++;
    if (ids.slice(0, 3).includes(truth)) t3++;
    hops += net.hopsFrom(ids[0]).get(truth) ?? 0;

    const naive = naiveRanking(net, readings);
    if (naive[0] === truth) b1++;
    if (naive.slice(0, 3).includes(truth)) b3++;
    bhops += net.hopsFrom(naive[0]).get(truth) ?? 0;
  }
  const n = TEST_SEEDS.length;
  const m = (top1: number, top3: number, h: number, ins: number): Metrics => ({
    n,
    top1: round(top1 / n, 3),
    top3: round(top3 / n, 3),
    mean_hop_error: round(h / n, 2),
    insufficient: round(ins / n, 3),
    skipped: 0, // the surrogate never fails to converge; the real backend counts WNTR failures here
  });
  return { method: m(t1, t3, hops, insufficient), baseline: m(b1, b3, bhops, 0) };
}

let cached: EvalResponse | null = null;

export function evaluationReport(net: Net): EvalResponse {
  if (cached) return cached;
  const main = evaluate(net, {});
  const withBaseline = (r: { method: Metrics; baseline: Metrics }): Metrics => ({ ...r.method, baseline_top3: r.baseline.top3 });

  const sensors = defaultSensors(net, DEFAULT_SENSORS_K);
  let flaggedNoLeak = 0;
  for (const seed of NO_LEAK_SEEDS) {
    const sc = simulate(net, seed, { leak: false, noise: "mid" });
    if (detect(net, observe(net, sc, sensors), sensors, "mid", sc.noiseSigma).response.status !== "ok") flaggedNoLeak++;
  }
  const small = evaluate(net, { size: "small" });

  cached = {
    meta: {
      seeds: TEST_SEEDS.length,
      k: DEFAULT_SENSORS_K,
      tau: 0.25,
      time_step: "t0",
      network: "Net3",
      note: "MOCK physics surrogate: demand multiplier ±10%, sensor noise, synthetic scenarios. Replace with backend eval.json.",
      generated_at: new Date(0).toISOString(),
    },
    results: main.method,
    baseline: main.baseline,
    by_noise: {
      low: withBaseline(evaluate(net, { noise: "low" })),
      mid: withBaseline(main),
      high: withBaseline(evaluate(net, { noise: "high" })),
    },
    by_size: {
      small: withBaseline(small),
      medium: withBaseline(evaluate(net, { size: "medium" })),
      large: withBaseline(evaluate(net, { size: "large" })),
    },
    by_k: {
      "3": withBaseline(evaluate(net, { k: 3 })),
      "6": withBaseline(main),
      "10": withBaseline(evaluate(net, { k: 10 })),
    },
    gate: {
      no_leak_flagged: round(flaggedNoLeak / NO_LEAK_SEEDS.length, 3),
      small_leak_flagged: small.method.insufficient,
    },
  };
  return cached;
}
