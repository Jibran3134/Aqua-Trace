import { describe, expect, it } from "vitest";
import { rng } from "../lib/rng";
import { optimizeRepairs } from "./repair";

function bruteForce(costs: number[], litres: number[], budget: number): number {
  let best = 0;
  for (let mask = 0; mask < 1 << costs.length; mask++) {
    let c = 0;
    let l = 0;
    for (let i = 0; i < costs.length; i++) {
      if (mask & (1 << i)) {
        c += costs[i];
        l += litres[i];
      }
    }
    if (c <= budget) best = Math.max(best, l);
  }
  return best;
}

describe("repair optimizer (mock T13)", () => {
  it("DP matches brute force and never loses to greedy on random instances", () => {
    const rand = rng(7);
    for (let t = 0; t < 200; t++) {
      const n = 1 + Math.floor(rand() * 7);
      const cands = Array.from({ length: n }, (_, i) => ({
        node: `n${i}`,
        est_leak_lps: Math.round(rand() * 2000) / 100,
        repair_cost_pkr: (1 + Math.floor(rand() * 40)) * 10_000,
      }));
      const budget = Math.floor(rand() * 400) * 1000;
      const r = optimizeRepairs(budget, cands);
      const expected = bruteForce(
        cands.map((c) => c.repair_cost_pkr),
        cands.map((c) => c.est_leak_lps * 86_400),
        budget,
      );
      expect(r.litres_per_day_saved).toBe(Math.round(expected));
      expect(r.litres_per_day_saved).toBeGreaterThanOrEqual(r.greedy.litres_per_day_saved);
      expect(r.total_cost_pkr).toBeLessThanOrEqual(budget);
    }
  });

  it("handles edge cases from the plan", () => {
    expect(optimizeRepairs(0, [{ node: "a", est_leak_lps: 5, repair_cost_pkr: 1000 }]).selected).toEqual([]);
    expect(optimizeRepairs(500, [{ node: "a", est_leak_lps: 5, repair_cost_pkr: 1000 }]).note).toMatch(/below the cheapest/);
    expect(optimizeRepairs(1e6, []).note).toMatch(/no repair candidates/);
    const flagged = optimizeRepairs(1e6, [{ node: "a", est_leak_lps: 5 }]);
    expect(flagged.selected[0].cost_defaulted).toBe(true);
    // Equal value: the cheaper repair wins.
    const tie = optimizeRepairs(200_000, [
      { node: "pricey", est_leak_lps: 5, repair_cost_pkr: 200_000 },
      { node: "cheap", est_leak_lps: 5, repair_cost_pkr: 100_000 },
    ]);
    expect(tie.selected.map((s) => s.node)).toEqual(["cheap"]);
  });
});
