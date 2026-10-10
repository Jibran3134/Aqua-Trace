// Mock of backend task T13 (stretch S2+S3): pick repairs that save the most water within a budget.
// 0/1 knapsack by DP over cost in units of Rs 100; greedy (by litres per rupee) returned to compare.
import type { RepairCandidate, RepairResponse, RepairSelection } from "../contracts/types";
import { round } from "./detector";

export const DEFAULT_VALUE_PER_LITRE_PKR = 0.05; // ASSUMPTION: replace with utility data
export const DEFAULT_REPAIR_COST_PKR = 150_000; // ASSUMPTION: replace with utility data
const COST_UNIT = 100;

interface Item {
  node: string;
  lps: number;
  cost: number;
  litres: number;
  defaulted: boolean;
}

function solveDp(items: Item[], budget: number): Item[] {
  const cap = Math.floor(budget / COST_UNIT);
  const w = items.map((it) => Math.ceil(it.cost / COST_UNIT));
  // best[c] = max litres within capacity c, spent[c] = cost of that set; keep[i][c] = item i taken.
  // Lexicographic objective: more litres first, then lower cost (plan: "tie in value -> cheaper").
  const best = new Float64Array(cap + 1);
  const spent = new Float64Array(cap + 1);
  const keep = items.map(() => new Uint8Array(cap + 1));
  items.forEach((it, i) => {
    for (let c = cap; c >= w[i]; c--) {
      const v = best[c - w[i]] + it.litres;
      const cost = spent[c - w[i]] + it.cost;
      if (v > best[c] + 1e-9 || (Math.abs(v - best[c]) <= 1e-9 && cost < spent[c])) {
        best[c] = v;
        spent[c] = cost;
        keep[i][c] = 1;
      }
    }
  });
  const chosen: Item[] = [];
  let c = cap;
  for (let i = items.length - 1; i >= 0; i--) {
    if (keep[i][c]) {
      chosen.push(items[i]);
      c -= w[i];
    }
  }
  return chosen.reverse();
}

function solveGreedy(items: Item[], budget: number): Item[] {
  const sorted = [...items].sort((a, b) => b.litres / b.cost - a.litres / a.cost || a.cost - b.cost);
  const chosen: Item[] = [];
  let left = budget;
  for (const it of sorted) {
    if (it.cost <= left) {
      chosen.push(it);
      left -= it.cost;
    }
  }
  return chosen;
}

export function optimizeRepairs(budget: number, candidates: RepairCandidate[], valuePerLitre = DEFAULT_VALUE_PER_LITRE_PKR): RepairResponse {
  const items: Item[] = candidates.map((c) => {
    const defaulted = !(typeof c.repair_cost_pkr === "number" && c.repair_cost_pkr > 0);
    return {
      node: c.node,
      lps: c.est_leak_lps,
      cost: defaulted ? DEFAULT_REPAIR_COST_PKR : Math.round(c.repair_cost_pkr!),
      litres: Math.max(0, c.est_leak_lps) * 86_400,
      defaulted,
    };
  });
  const dp = budget > 0 ? solveDp(items, budget) : [];
  const greedy = budget > 0 ? solveGreedy(items, budget) : [];
  const sum = (xs: Item[], f: (x: Item) => number) => xs.reduce((s, x) => s + f(x), 0);

  const litres = sum(dp, (x) => x.litres);
  const cost = sum(dp, (x) => x.cost);
  const valuePerDay = litres * valuePerLitre;
  const selected: RepairSelection[] = dp.map((x) => ({
    node: x.node,
    est_leak_lps: x.lps,
    repair_cost_pkr: x.cost,
    litres_per_day: Math.round(x.litres),
    cost_defaulted: x.defaulted,
  }));
  let note = "assumes independent leaks";
  if (!candidates.length) note = "no repair candidates; confirm leaks first";
  else if (budget <= 0) note = "budget is zero; nothing can be repaired";
  else if (!dp.length) note = "budget is below the cheapest repair";

  return {
    selected,
    total_cost_pkr: cost,
    litres_per_day_saved: Math.round(litres),
    value_pkr_per_day: round(valuePerDay, 0),
    payback_days: valuePerDay > 0 ? round(cost / valuePerDay, 1) : null,
    greedy: { selected: greedy.map((x) => x.node), total_cost_pkr: sum(greedy, (x) => x.cost), litres_per_day_saved: Math.round(sum(greedy, (x) => x.litres)) },
    assumptions: { value_per_litre_pkr: valuePerLitre, default_repair_cost_pkr: DEFAULT_REPAIR_COST_PKR, label: "ASSUMPTION: replace with utility data" },
    note,
  };
}
