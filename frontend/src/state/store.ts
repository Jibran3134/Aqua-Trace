import { toast } from "sonner";
import { create } from "zustand";
import { ApiError, api } from "../api/client";
import type {
  DetectResponse,
  HealthResponse,
  LeakSize,
  NetworkResponse,
  NoiseLevel,
  RevealResponse,
  ScenarioResponse,
} from "../contracts/types";
import { Graph } from "../lib/graph";

export type Busy = null | "network" | "simulate" | "detect" | "reveal";

export interface Controls {
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

  focusNode: string | null;
  hoverNode: string | null;
  /** Camera request for the map: one id centers on it, several ids frame them. Nonce allows repeats. */
  flyTarget: { ids: string[]; nonce: number } | null;

  setControls: (c: Partial<Controls>) => void;
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

  controls: { seed: "", noise: "mid", k: 6, size: "random" },
  busy: null,
  epoch: 0,

  scenario: null,
  detection: null,
  reveal: null,
  expired: false,

  focusNode: null,
  hoverNode: null,
  flyTarget: null,

  setControls: (c) => set((s) => ({ controls: { ...s.controls, ...c } })),
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
    set({ busy: "simulate", epoch, scenario: null, detection: null, reveal: null, expired: false, focusNode: null });
    const seed = over?.seed ?? (controls.seed.trim() === "" ? undefined : Number(controls.seed));
    if (seed !== undefined && (!Number.isInteger(seed) || seed < 0)) {
      set({ busy: null });
      toast.error("Seed must be a whole number", { description: "Leave it blank for a random scenario." });
      return;
    }
    try {
      const scenario = await api.leak({
        seed,
        noise: controls.noise,
        k: over?.sensors ? undefined : controls.k,
        sensors: over?.sensors,
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
    set({ busy: "detect" });
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
}));
