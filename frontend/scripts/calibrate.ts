// Prints mock detector accuracy so surrogate constants can be tuned. Usage: npx tsx scripts/calibrate.ts
import { defaultSensors, loadNet, observe, simulate } from "../src/mock/physics";
import { detect, naiveRanking } from "../src/mock/detector";
import type { NoiseLevel } from "../src/contracts/types";

const net = loadNet();
for (const k of [3, 6, 10]) {
  const sensors = defaultSensors(net, k);
  for (const noise of ["low", "mid", "high"] as NoiseLevel[]) {
    let t1 = 0, t3 = 0, ins = 0, nl = 0, b3 = 0, hop = 0;
    const N = 100;
    for (let seed = 1000; seed < 1000 + N; seed++) {
      const sc = simulate(net, seed, { noise });
      const r = observe(net, sc, sensors);
      const { response } = detect(net, r, sensors, noise, sc.noiseSigma);
      const ids = response.candidates.map((c) => c.node);
      if (response.status !== "ok") ins++;
      if (ids[0] === sc.trueLeakNode) t1++;
      if (ids.slice(0, 3).includes(sc.trueLeakNode!)) t3++;
      hop += net.hopsFrom(ids[0]).get(sc.trueLeakNode!) ?? 0;
      if (naiveRanking(net, r).slice(0, 3).includes(sc.trueLeakNode!)) b3++;
      const z = simulate(net, seed, { leak: false, noise });
      if (detect(net, observe(net, z, sensors), sensors, noise, z.noiseSigma).response.status !== "ok") nl++;
    }
    console.log(`k=${k} ${noise}: top1 ${t1}% top3 ${t3}% hop ${(hop / N).toFixed(2)} insuff ${ins}% | naive top3 ${b3}% | no-leak flagged ${nl}%`);
  }
}
console.log("sensors k=6:", defaultSensors(net, 6));
