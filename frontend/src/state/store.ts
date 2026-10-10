import { toast } from "sonner";
import { create } from "zustand";
import { ApiError, api } from "../api/client";
import type {
  AgentEvent,
  AgentSource,
  DetectResponse,
  EvalResponse,
  InvestigationState,
  HealthResponse,
  LeakSize,
  NetworkResponse,
  NoiseLevel,
  RevealResponse,
  RepairResponse,
  ScenarioResponse,
  SensorPlaceResponse,
} from "../contracts/types";
import { Graph } from "../lib/graph";

export type Busy = null | "network" | "simulate" | "detect" | "reveal" | "agent" | "field" | "place" | "repair";

export interface BacklogItem {
  node: string;
  est_leak_lps: number;
  repair_cost_pkr: number | null; // null = server default (flagged)
  seed: number | null;
  source: "crew" | "sample";
}

const BACKLOG_KEY = "aquatrace.backlog.v1";
function loadBacklog(): BacklogItem[] {
  try {
    const raw = localStorage.getItem(BACKLOG_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function saveBacklog(items: BacklogItem[]) {
  try {
    localStorage.setItem(BACKLOG_KEY, JSON.stringify(items));
  } catch {
    // Private mode / blocked storage: the backlog just won't survive a reload.
  }
}

/** Clearly-labeled sample entries so the optimizer can be shown before any crew has confirmed leaks. */
export const SAMPLE_BACKLOG: BacklogItem[] = [
  { node: "123", est_leak_lps: 9.4, repair_cost_pkr: 220_000, seed: null, source: "sample" },
  { node: "207", est_leak_lps: 6.1, repair_cost_pkr: 120_000, seed: null, source: "sample" },
  { node: "143", est_leak_lps: 3.2, repair_cost_pkr: 60_000, seed: null, source: "sample" },
  { node: "253", est_leak_lps: 12.8, repair_cost_pkr: 340_000, seed: null, source: "sample" },
  { node: "35", est_leak_lps: 4.5, repair_cost_pkr: null, seed: null, source: "sample" },
];
export type TabId = "candidates" | "agent" | "evaluation" | "sensors" | "repairs";

export interface AgentRun {
  events: AgentEvent[];
  source: AgentSource | null;
  state: InvestigationState | "idle";
  recommended: string | null;
  route: string[];
  routeLength: number | null;
  /** Nodes the crew checked and found nothing, in visit order. */
  cleared: string[];
  foundAt: string | null;
  error: ApiError | null;
}

const EMPTY_AGENT: AgentRun = {
  events: [],
  source: null,
  state: "idle",
  recommended: null,
  route: [],
  routeLength: null,
  cleared: [],
  foundAt: null,
  error: null,
};

export interface Controls {
  /** "random", "custom", or a DemoPreset id. */
  preset: string;
  seed: string; // blank = random
  noise: NoiseLevel;
  k: number;
  size: LeakSize | "random";
}

interface State {
  network: NetworkResponse | null;
  graph: Graph | null;
  networkError: ApiError | null;
  health: HealthResponse | null;

  controls: Controls;
  busy: Busy;
  /** Bumped whenever a new scenario starts; responses tagged with an older value are dropped. */
  epoch: number;

  scenario: ScenarioResponse | null;
  detection: DetectResponse | null;
  reveal: RevealResponse | null;
  expired: boolean;

  agent: AgentRun;
  tab: TabId;
  helpOpen: boolean;
  setHelp: (open: boolean) => void;
  /** True while the agent timeline is still revealing events (presenter cues wait for it). */
  narrating: boolean;
  setNarrating: (v: boolean) => void;
  evaluation: EvalResponse | null;
  evaluationError: ApiError | null;
  placement: SensorPlaceResponse | null;
  placementK: number;
  /** Sensor set chosen in the Sensors tab; used by the next Simulate instead of default_sensors(k). */
  customSensors: string[] | null;
  backlog: BacklogItem[];
  repairBudget: number;
  valuePerLitre: number;
  repair: RepairResponse | null;

  focusNode: string | null;
  hoverNode: string | null;
  /** Camera request for the map: one id centers on it, several ids frame them. Nonce allows repeats. */
  flyTarget: { ids: string[]; nonce: number } | null;

  setControls: (c: Partial<Controls>) => void;
  setTab: (t: TabId) => void;
  investigate: () => Promise<void>;
  /** true/false = manual report; "crew" = let the server's simulated crew inspect the node. */
  reportField: (outcome: boolean | "crew") => Promise<void>;
  loadEvaluation: () => Promise<void>;
  loadPlacement: (k: number) => Promise<void>;
  applySensors: (ids: string[] | null) => void;
  setBacklog: (items: BacklogItem[]) => void;
  setRepairInputs: (p: { budget?: number; valuePerLitre?: number }) => void;
  optimizeRepairs: () => Promise<void>;
  setFocus: (id: string | null) => void;
  setHover: (id: string | null) => void;
  flyTo: (id: string) => void;
  frame: (ids: string[]) => void;
  loadNetwork: () => Promise<void>;
  pollHealth: () => Promise<void>;
  /** Overrides re-run a specific seed/sensor set (e.g. 'add the recommended sensor and retry'). */
  simulate: (over?: { seed?: number; sensors?: string[] }) => Promise<void>;
  detect: () => Promise<void>;
  revealTruth: () => Promise<void>;
}

function report(e: unknown, what: string) {
  if (e instanceof DOMException && e.name === "AbortError") return;
  if (e instanceof ApiError) toast.error(e.message, { description: e.hint, id: `${what}-${e.code}` });
  else toast.error(`${what} failed`, { description: String(e) });
}

export const useStore = create<State>((set, get) => ({
  network: null,
  graph: null,
  networkError: null,
  health: null,

  controls: { preset: "random", seed: "", noise: "mid", k: 6, size: "random" },
  busy: null,
  epoch: 0,

  scenario: null,
  detection: null,
  reveal: null,
  expired: false,

  agent: EMPTY_AGENT,
  tab: "candidates",
  helpOpen: false,
  setHelp: (helpOpen) => set({ helpOpen }),
  narrating: false,
  setNarrating: (narrating) => set({ narrating }),
  evaluation: null,
  evaluationError: null,
  placement: null,
  placementK: 6,
  customSensors: null,
  backlog: loadBacklog(),
  repairBudget: 500_000,
  valuePerLitre: 0.05,
  repair: null,

  focusNode: null,
  hoverNode: null,
  flyTarget: null,

  setControls: (c) => set((s) => ({ controls: { ...s.controls, ...c } })),
  setTab: (tab) => set({ tab }),
  setFocus: (focusNode) => set({ focusNode }),
  setHover: (hoverNode) => set({ hoverNode }),
  flyTo: (id) => set((s) => ({ focusNode: id, flyTarget: { ids: [id], nonce: (s.flyTarget?.nonce ?? 0) + 1 } })),
  frame: (ids) => set((s) => ({ flyTarget: { ids, nonce: (s.flyTarget?.nonce ?? 0) + 1 } })),

  loadNetwork: async () => {
    set({ busy: "network", networkError: null });
    try {
      const network = await api.network();
      const graph = new Graph(
        network.nodes.map((n) => n.id),
        network.pipes,
      );
      set({ network, graph });
    } catch (e) {
      set({ networkError: e instanceof ApiError ? e : new ApiError(0, "internal_error", String(e), "Reload the page.") });
    } finally {
      set({ busy: null });
    }
  },

  pollHealth: async () => {
    try {
      set({ health: await api.health() });
    } catch {
      // Network errors surface through loadNetwork; health polling stays silent.
    }
  },

  simulate: async (over) => {
    const { controls, busy } = get();
    if (busy) return;
    const epoch = get().epoch + 1;
    // Results of the top-bar flow always show on Candidates, whatever tab was open.
    set({ busy: "simulate", epoch, scenario: null, detection: null, reveal: null, expired: false, focusNode: null, agent: EMPTY_AGENT, tab: "candidates" });
    const seed = over?.seed ?? (controls.preset === "random" || controls.seed.trim() === "" ? undefined : Number(controls.seed));
    const sensors = over?.sensors ?? get().customSensors ?? undefined;
    if (seed !== undefined && (!Number.isInteger(seed) || seed < 0)) {
      set({ busy: null });
      toast.error("Seed must be a whole number", { description: "Leave it blank for a random scenario." });
      return;
    }
    try {
      const scenario = await api.leak({
        seed,
        noise: controls.noise,
        k: sensors ? undefined : controls.k,
        sensors,
        size: controls.size === "random" ? undefined : controls.size,
      });
      if (get().epoch !== epoch) return;
      set({ scenario });
      const offline = Object.values(scenario.readings).filter((v) => v === null).length;
      toast(`Hidden leak simulated · seed ${scenario.seed ?? "?"}`, {
        description: `${scenario.sensors.length} sensors reporting${offline ? `, ${offline} offline` : ""}. The location stays hidden until Reveal.`,
      });
    } catch (e) {
      if (get().epoch === epoch) report(e, "Simulation");
    } finally {
      if (get().epoch === epoch) set({ busy: null });
    }
  },

  detect: async () => {
    const { scenario, busy, epoch } = get();
    if (!scenario || busy) return;
    set({ busy: "detect", tab: "candidates" });
    try {
      const detection = await api.detect(scenario.scenario_id);
      if (get().epoch !== epoch) return;
      set({ detection, focusNode: detection.candidates[0]?.node ?? null });
      // Frame the leading cluster so the audience sees where to look, not the whole city.
      const lead = detection.status === "ok" ? detection.candidates.slice(0, 3).map((c) => c.node) : [];
      if (lead.length) get().frame(lead);
    } catch (e) {
      if (get().epoch !== epoch) return;
      if (e instanceof ApiError && e.code === "scenario_not_found") set({ expired: true });
      else report(e, "Detection");
    } finally {
      if (get().epoch === epoch) set({ busy: null });
    }
  },

  revealTruth: async () => {
    const { scenario, busy, epoch } = get();
    if (!scenario || busy) return;
    set({ busy: "reveal" });
    try {
      const reveal = await api.reveal(scenario.scenario_id);
      if (get().epoch !== epoch) return;
      set({ reveal });
      const top1 = get().detection?.candidates[0]?.node;
      // A miss is shown together with the top candidate so the hop path is visible.
      if (top1 && top1 !== reveal.true_leak_node) get().frame([top1, reveal.true_leak_node]);
      else get().flyTo(reveal.true_leak_node);
    } catch (e) {
      if (get().epoch !== epoch) return;
      if (e instanceof ApiError && e.code === "scenario_not_found") set({ expired: true });
      else report(e, "Reveal");
    } finally {
      if (get().epoch === epoch) set({ busy: null });
    }
  },

  investigate: async () => {
    const { scenario, busy, epoch } = get();
    if (!scenario || busy) return;
    set((s) => ({ busy: "agent", tab: "agent", agent: { ...s.agent, error: null } }));
    try {
      const res = await api.agentStep({ scenario_id: scenario.scenario_id, mode: "auto" });
      if (get().epoch !== epoch) return;
      // Steps restart at 1 each turn; offset them so the timeline keeps one running count.
      const prev = get().agent.events;
      const offset = prev.length ? prev[prev.length - 1].step : 0;
      const events = res.events.map((e) => ({ ...e, step: e.step + offset }));
      set((s) => ({
        agent: {
          ...s.agent,
          events: [...prev, ...events],
          source: res.source,
          state: res.state,
          recommended: res.recommended_node ?? null,
          route: res.route ?? [],
          routeLength: res.route_length_m ?? null,
        },
      }));
      if (res.state === "investigating" && res.route?.length) get().frame(res.route);
      else if (res.recommended_node) get().flyTo(res.recommended_node);
    } catch (e) {
      if (get().epoch !== epoch) return;
      if (e instanceof ApiError && e.code === "scenario_not_found") set({ expired: true });
      else set((s) => ({ agent: { ...s.agent, error: e instanceof ApiError ? e : new ApiError(0, "internal_error", String(e), "Retry.") } }));
    } finally {
      if (get().epoch === epoch) set({ busy: null });
    }
  },

  reportField: async (outcome) => {
    const { scenario, busy, epoch, agent } = get();
    const node = agent.recommended;
    if (!scenario || busy || !node || agent.state !== "investigating") return;
    set({ busy: "field" });
    try {
      const found =
        outcome === "crew"
          ? (await api.inspect({ scenario_id: scenario.scenario_id, node })).found
          : (await api.fieldResult({ scenario_id: scenario.scenario_id, node, found: outcome }), outcome);
      if (get().epoch !== epoch) return;
      if (found) {
        const est = get().detection?.candidates.find((c) => c.node === node)?.est_leak_lps ?? 0;
        const item: BacklogItem = { node, est_leak_lps: est, repair_cost_pkr: null, seed: scenario.seed ?? null, source: "crew" };
        get().setBacklog([...get().backlog.filter((b) => b.node !== node), item]);
      }
      if (outcome === "crew") {
        toast(found ? `Crew at node ${node}: leak found` : `Crew at node ${node}: nothing found`, {
          description: found ? "Closing the investigation." : "Down-weighting this node and re-ranking.",
        });
      }
      set((s) => ({
        agent: {
          ...s.agent,
          cleared: found ? s.agent.cleared : [...s.agent.cleared, node],
          foundAt: found ? node : null,
          recommended: null,
          route: [],
        },
      }));
      // The ranking moved: refresh candidates (posterior-aware) so map and list agree.
      const detection = await api.detect(scenario.scenario_id);
      if (get().epoch !== epoch) return;
      set({ detection, busy: null });
      await get().investigate();
    } catch (e) {
      if (get().epoch !== epoch) return;
      if (e instanceof ApiError && e.code === "scenario_not_found") set({ expired: true });
      else report(e, "Field report");
      set({ busy: null });
    }
  },

  loadEvaluation: async () => {
    if (get().evaluation) return;
    set({ evaluationError: null });
    try {
      set({ evaluation: await api.eval() });
    } catch (e) {
      set({ evaluationError: e instanceof ApiError ? e : new ApiError(0, "internal_error", String(e), "Retry.") });
    }
  },

  loadPlacement: async (k) => {
    if (get().busy) return;
    set({ busy: "place", placementK: k });
    try {
      const placement = await api.placeSensors({ k, noise: get().controls.noise });
      if (get().placementK === k) set({ placement });
    } catch (e) {
      report(e, "Sensor placement");
    } finally {
      set({ busy: null });
    }
  },

  applySensors: (ids) => {
    set({ customSensors: ids });
    toast(ids ? `Using ${ids.length} optimized sensors` : "Back to default sensors", {
      description: ids ? "The next simulated leak is read by these sensors." : "Farthest-point placement, k from the top bar.",
    });
  },

  setBacklog: (backlog) => {
    saveBacklog(backlog);
    set({ backlog, repair: null });
  },

  setRepairInputs: ({ budget, valuePerLitre }) =>
    set((s) => ({ repairBudget: budget ?? s.repairBudget, valuePerLitre: valuePerLitre ?? s.valuePerLitre, repair: null })),

  optimizeRepairs: async () => {
    const { backlog, repairBudget, valuePerLitre, busy } = get();
    if (busy) return;
    set({ busy: "repair" });
    try {
      const repair = await api.optimizeRepair({
        budget_pkr: repairBudget,
        value_per_litre_pkr: valuePerLitre,
        candidates: backlog.map((b) => ({ node: b.node, est_leak_lps: b.est_leak_lps, ...(b.repair_cost_pkr ? { repair_cost_pkr: b.repair_cost_pkr } : {}) })),
      });
      set({ repair });
      if (repair.selected.length) get().frame(repair.selected.map((r) => r.node));
    } catch (e) {
      report(e, "Repair optimization");
    } finally {
      set({ busy: null });
    }
  },
}));
