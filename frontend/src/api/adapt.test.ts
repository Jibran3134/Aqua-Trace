import { describe, expect, it } from "vitest";

import {
  adaptHealth,
  adaptNetwork,
  adaptPlacement,
  adaptRepair,
  adaptReveal,
  adaptScenario,
  placementRequest,
  repairRequest,
} from "./adapt";
import type { RepairRequest } from "../contracts/types";

/**
 * Payloads below use the backend's real field names, copied from
 * backend/app/schemas/api.py. If the backend renames a field, these fail.
 */

describe("adaptHealth", () => {
  it("maps signatures_progress to progress", () => {
    const h = adaptHealth({
      status: "ok",
      signatures_ready: false,
      signatures_progress: 0.42,
      database: "ok",
      redis: "ok",
    });
    expect(h.progress).toBe(0.42);
    expect(h.signatures_ready).toBe(false);
  });

  it("keeps a degraded status and surfaces the failing dependency", () => {
    const h = adaptHealth({
      status: "degraded",
      signatures_ready: true,
      signatures_progress: 1,
      database: "unavailable",
      redis: "ok",
    });
    expect(h.status).toBe("degraded");
    expect(h.database).toBe("unavailable");
  });

  it("passes a contract-shaped mock payload through unchanged", () => {
    expect(adaptHealth({ status: "ok", signatures_ready: true, progress: 1 }).progress).toBe(1);
  });
});

describe("adaptNetwork", () => {
  const backend = {
    nodes: [
      { id: "10", x: 9, y: 27.85, type: "junction" },
      { id: "River", x: 1, y: 2, type: "reservoir" },
    ],
    pipes: [
      { id: "101", from: "10", to: "101", length: 4328, type: "pipe" },
      { id: "335", from: "1", to: "2", length: 0, type: "pump" },
    ],
    default_sensors: ["10", "123"],
    provenance: { coordinates: "assumed: Net3 schematic coordinates, not geographic" },
  };

  it("maps pipe.type to pipe.kind so pumps keep their own style", () => {
    const n = adaptNetwork(backend);
    expect(n.pipes.map((p) => p.kind)).toEqual(["pipe", "pump"]);
  });

  it("leaves node.type alone", () => {
    expect(adaptNetwork(backend).nodes.map((n) => n.type)).toEqual(["junction", "reservoir"]);
  });

  it("prefers an existing kind field and drops unknown values", () => {
    const n = adaptNetwork({ nodes: [], pipes: [{ id: "1", from: "a", to: "b", length: 1, kind: "valve" }, { id: "2", from: "a", to: "b", length: 1, type: "sewer" }], default_sensors: [] });
    expect(n.pipes.map((p) => p.kind)).toEqual(["valve", "pipe"]);
  });
});

describe("adaptScenario", () => {
  const backend = {
    scenario_id: "0b3f8a1e-5c7d-4f2a-9b1e-2d3c4e5f6a7b",
    sensors: ["10", "15"],
    readings: { "10": 22.13, "15": null },
    meta: {
      time_step: "t0",
      noise_sigma: 0.2,
      demand_mult_known: false,
      provenance: { readings: "simulated: hydraulic pressure in metres" },
    },
  };

  it("falls back to the requested seed and noise, which the backend does not echo", () => {
    const s = adaptScenario(backend, { seed: 1042, noise: "high" });
    expect(s.seed).toBe(1042);
    expect(s.meta.noise_level).toBe("high");
    expect(s.scenario_id).toBe(backend.scenario_id);
  });

  it("leaves the seed undefined when none was requested", () => {
    expect(adaptScenario(backend, {}).seed).toBeUndefined();
  });

  it("keeps an offline sensor as null rather than 0", () => {
    const s = adaptScenario(backend, {});
    expect(s.readings["15"]).toBeNull();
    expect(s.readings["10"]).toBe(22.13);
  });
});

describe("adaptReveal", () => {
  it("turns nullable rank and hop error into -1", () => {
    const r = adaptReveal({
      true_leak_node: "213",
      true_size: "medium",
      rank_of_truth: null,
      hop_error_top1: null,
      provenance: "simulated: hidden hydraulic ground truth",
    });
    expect(r.rank_of_truth).toBe(-1);
    expect(r.hop_error_top1).toBe(-1);
  });

  it("keeps real values", () => {
    const r = adaptReveal({ true_leak_node: "213", true_size: "large", rank_of_truth: 2, hop_error_top1: 1 });
    expect([r.rank_of_truth, r.hop_error_top1, r.true_size]).toEqual([2, 1, "large"]);
  });
});

describe("request shaping for routes that forbid extra fields", () => {
  it("drops noise from the placement request", () => {
    expect(placementRequest({ k: 6, noise: "mid" })).toEqual({ k: 6 });
  });

  it("drops value_per_litre_pkr and omits absent costs", () => {
    const body = repairRequest({
      budget_pkr: 500_000,
      value_per_litre_pkr: 0.05,
      candidates: [
        { node: "211", est_leak_lps: 6.8, repair_cost_pkr: 180_000 },
        { node: "213", est_leak_lps: 4.1 },
      ],
    });
    expect(body).toEqual({
      budget_pkr: 500_000,
      candidates: [
        { node: "211", est_leak_lps: 6.8, repair_cost_pkr: 180_000 },
        { node: "213", est_leak_lps: 4.1 },
      ],
    });
    expect("value_per_litre_pkr" in body).toBe(false);
  });
});

describe("adaptPlacement", () => {
  it("accepts a curve without baseline_top3", () => {
    const p = adaptPlacement({ sensors: ["10"], curve: [{ k: 1, top1: 0.05, top3: 0.12 }], provenance: "simulated" });
    expect(p.curve[0].baseline_top3).toBeUndefined();
    expect(p.sensors).toEqual(["10"]);
  });
});

describe("adaptRepair", () => {
  const req: RepairRequest = {
    budget_pkr: 500_000,
    value_per_litre_pkr: 0.05,
    candidates: [
      { node: "211", est_leak_lps: 6.8, repair_cost_pkr: 180_000 },
      { node: "213", est_leak_lps: 4.1 },
    ],
  };
  const backend = {
    selected: { nodes: ["211"], total_cost_pkr: 180_000, litres_per_day: 587_520 },
    greedy: { nodes: ["211"], total_cost_pkr: 180_000, litres_per_day: 587_520 },
    budget_pkr: 500_000,
    defaulted_cost_nodes: ["213"],
    assumptions: { value_per_litre_pkr: 0.05, default_repair_cost_pkr: 150_000, label: "ASSUMPTION: replace with utility data" },
    note: "Assumes independent leaks; savings are simulated estimates.",
  };

  it("rebuilds per-node rows from the submitted candidates", () => {
    const r = adaptRepair(backend, req);
    expect(r.selected).toEqual([
      { node: "211", est_leak_lps: 6.8, repair_cost_pkr: 180_000, litres_per_day: 6.8 * 86_400, cost_defaulted: false },
    ]);
    expect(r.total_cost_pkr).toBe(180_000);
    expect(r.litres_per_day_saved).toBe(587_520);
  });

  it("derives value per day and payback from the assumptions", () => {
    const r = adaptRepair(backend, req);
    expect(r.value_pkr_per_day).toBeCloseTo(587_520 * 0.05, 6);
    expect(r.payback_days).toBeCloseTo(180_000 / (587_520 * 0.05), 6);
  });

  it("returns null payback when nothing is saved", () => {
    const empty = { ...backend, selected: { nodes: [], total_cost_pkr: 0, litres_per_day: 0 } };
    expect(adaptRepair(empty, req).payback_days).toBeNull();
  });

  it("flags a defaulted cost for a candidate submitted without one", () => {
    const withBoth = { ...backend, selected: { nodes: ["211", "213"], total_cost_pkr: 330_000, litres_per_day: 1 } };
    const rows = adaptRepair(withBoth, req).selected;
    expect(rows.map((r) => r.cost_defaulted)).toEqual([false, true]);
    expect(rows[1].repair_cost_pkr).toBe(150_000);
  });

  it("passes a contract-shaped mock response through untouched", () => {
    const contract = { selected: [], total_cost_pkr: 0, litres_per_day_saved: 0, value_pkr_per_day: 0, payback_days: null, greedy: { selected: [], total_cost_pkr: 0, litres_per_day_saved: 0 }, assumptions: { value_per_litre_pkr: 0.05, default_repair_cost_pkr: 1, label: "x" }, note: "n" };
    expect(adaptRepair(contract, req)).toBe(contract);
  });
});
