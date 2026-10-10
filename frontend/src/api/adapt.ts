/**
 * Backend wire format -> contract types.
 *
 * `backend/app/schemas/api.py` and `contracts/api.md` disagree on a handful of
 * field names. Components only ever read contract types, so every mapping lives
 * here and nowhere else.
 *
 * Known differences (verified against backend/app/schemas/api.py):
 *   /health            signatures_progress -> progress; status can be "degraded"
 *   /network           pipe.type           -> pipe.kind  (node.type is unchanged)
 *   /scenario/leak     no `seed` echoed    -> fall back to the seed we requested
 *   /reveal            nullable rank/hops  -> -1 ("outside the list")
 *   /sensors/place     request forbids `noise`
 *   /repair/optimize   request forbids `value_per_litre_pkr`; response shape differs
 *
 * Every function is tolerant and idempotent, so a contract-shaped payload (the
 * in-browser mock engine) passes straight through.
 */
import type {
  HealthResponse,
  LeakSize,
  LinkKind,
  NetworkResponse,
  NodeType,
  NoiseLevel,
  RepairRequest,
  RepairResponse,
  RevealResponse,
  ScenarioRequest,
  ScenarioResponse,
  SensorPlaceRequest,
  SensorPlaceResponse,
} from "../contracts/types";

type Rec = Record<string, unknown>;

const rec = (v: unknown): Rec => (typeof v === "object" && v !== null ? (v as Rec) : {});
const recs = (v: unknown): Rec[] => (Array.isArray(v) ? v.map(rec) : []);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

const NODE_TYPES = new Set<string>(["junction", "reservoir", "tank"]);
const LINK_KINDS = new Set<string>(["pipe", "pump", "valve"]);
const NOISE_LEVELS = new Set<string>(["low", "mid", "high"]);
const LEAK_SIZES = new Set<string>(["small", "medium", "large"]);

export function adaptHealth(raw: unknown): HealthResponse {
  const r = rec(raw);
  // Two different scales: the contract's `progress` is a 0..1 fraction, while the
  // backend's `signatures_progress` is a 0..100 percentage (verified live: 100.0
  // when ready). Keying off the field name avoids guessing at the boundary.
  const fraction = num(r.progress);
  const percent = num(r.signatures_progress);
  return {
    status: r.status === "degraded" ? "degraded" : "ok",
    signatures_ready: r.signatures_ready === true,
    progress: fraction ?? (percent === undefined ? 0 : percent / 100),
    database: str(r.database) === "unavailable" ? "unavailable" : str(r.database) === "ok" ? "ok" : undefined,
    redis: str(r.redis) === "unavailable" ? "unavailable" : str(r.redis) === "ok" ? "ok" : undefined,
  };
}

export function adaptNetwork(raw: unknown): NetworkResponse {
  const r = rec(raw);
  return {
    nodes: recs(r.nodes).map((n) => {
      const t = str(n.type);
      return {
        id: String(n.id),
        x: num(n.x) ?? 0,
        y: num(n.y) ?? 0,
        type: (t && NODE_TYPES.has(t) ? t : "junction") as NodeType,
      };
    }),
    pipes: recs(r.pipes).map((p) => {
      // The backend names the link kind `type`; the contract and the Cytoscape
      // stylesheet both key off `kind`, so pumps render dashed only after this.
      const k = str(p.kind) ?? str(p.type);
      return {
        id: String(p.id),
        from: String(p.from),
        to: String(p.to),
        length: num(p.length) ?? 0,
        kind: (k && LINK_KINDS.has(k) ? k : "pipe") as LinkKind,
      };
    }),
    default_sensors: strs(r.default_sensors),
  };
}

export function adaptScenario(raw: unknown, req: ScenarioRequest = {}): ScenarioResponse {
  const r = rec(raw);
  const meta = rec(r.meta);
  const readings: Record<string, number | null> = {};
  for (const [node, value] of Object.entries(rec(r.readings))) readings[node] = num(value) ?? null;
  const level = str(meta.noise_level) ?? req.noise;
  return {
    scenario_id: String(r.scenario_id ?? ""),
    // The backend picks a random seed when none is sent and does not echo it, so
    // a blank-seed run stays unreproducible until it returns one.
    seed: num(r.seed) ?? req.seed,
    sensors: strs(r.sensors),
    readings,
    meta: {
      time_step: "t0",
      noise_sigma: num(meta.noise_sigma) ?? 0,
      noise_level: level && NOISE_LEVELS.has(level) ? (level as NoiseLevel) : undefined,
      demand_mult_known: false,
    },
  };
}

export function adaptReveal(raw: unknown): RevealResponse {
  const r = rec(raw);
  const size = str(r.true_size);
  return {
    true_leak_node: String(r.true_leak_node ?? ""),
    true_size: (size && LEAK_SIZES.has(size) ? size : "medium") as LeakSize,
    // Null means detection never ran for this scenario. The UI reads <= 0 as
    // "outside the list", which is the honest rendering.
    rank_of_truth: num(r.rank_of_truth) ?? -1,
    hop_error_top1: num(r.hop_error_top1) ?? -1,
  };
}

/** PlacementRequest forbids extra fields, so `noise` has to be dropped. */
export function placementRequest(b: SensorPlaceRequest): { k: number } {
  return { k: b.k };
}

export function adaptPlacement(raw: unknown): SensorPlaceResponse {
  const r = rec(raw);
  return {
    sensors: strs(r.sensors),
    curve: recs(r.curve).map((p) => ({
      k: num(p.k) ?? 0,
      top1: num(p.top1) ?? 0,
      top3: num(p.top3) ?? 0,
      baseline_top3: num(p.baseline_top3),
    })),
  };
}

/** RepairRequest forbids extra fields, so `value_per_litre_pkr` has to be dropped. */
export function repairRequest(b: RepairRequest) {
  return {
    budget_pkr: b.budget_pkr,
    candidates: b.candidates.map((c) => ({
      node: c.node,
      est_leak_lps: c.est_leak_lps,
      ...(c.repair_cost_pkr === undefined ? {} : { repair_cost_pkr: c.repair_cost_pkr }),
    })),
  };
}

export function adaptRepair(raw: unknown, req: RepairRequest): RepairResponse {
  const r = rec(raw);
  // Contract-shaped already (mock engine returns `selected` as an array).
  if (Array.isArray(r.selected)) return raw as RepairResponse;

  const sel = rec(r.selected);
  const greedy = rec(r.greedy);
  const assumptions = rec(r.assumptions);
  const defaulted = new Set(strs(r.defaulted_cost_nodes));
  const byNode = new Map(req.candidates.map((c) => [c.node, c]));
  const valuePerLitre = num(assumptions.value_per_litre_pkr) ?? req.value_per_litre_pkr ?? 0;
  const defaultCost = num(assumptions.default_repair_cost_pkr) ?? 0;

  // The backend returns only the chosen node IDs; rebuild the per-node rows the
  // UI needs by joining against the candidates we submitted.
  const selected = strs(sel.nodes).map((node) => {
    const c = byNode.get(node);
    const lps = c?.est_leak_lps ?? 0;
    return {
      node,
      est_leak_lps: lps,
      repair_cost_pkr: c?.repair_cost_pkr ?? defaultCost,
      litres_per_day: lps * 86_400,
      cost_defaulted: defaulted.has(node) || c?.repair_cost_pkr === undefined,
    };
  });

  const litresSaved = num(sel.litres_per_day) ?? selected.reduce((a, s) => a + s.litres_per_day, 0);
  const totalCost = num(sel.total_cost_pkr) ?? selected.reduce((a, s) => a + s.repair_cost_pkr, 0);
  const valuePerDay = litresSaved * valuePerLitre;

  return {
    selected,
    total_cost_pkr: totalCost,
    litres_per_day_saved: litresSaved,
    value_pkr_per_day: valuePerDay,
    payback_days: valuePerDay > 0 ? totalCost / valuePerDay : null,
    greedy: {
      selected: strs(greedy.nodes),
      total_cost_pkr: num(greedy.total_cost_pkr) ?? 0,
      litres_per_day_saved: num(greedy.litres_per_day) ?? 0,
    },
    assumptions: {
      value_per_litre_pkr: valuePerLitre,
      default_repair_cost_pkr: defaultCost,
      label: str(assumptions.label) ?? "ASSUMPTION: replace with utility data",
    },
    note: str(r.note) ?? "assumes independent leaks",
  };
}
