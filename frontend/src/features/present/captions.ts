// Present-mode captions (plan W3). Templates over API values only — the same rule as the report:
// no number appears that an endpoint or tool did not return (or a labeled assumption).
import type { AgentEvent } from "../../contracts/types";
import type { useStore } from "../../state/store";

type S = ReturnType<typeof useStore.getState>;

export interface Chapter {
  /** 0..4 = Simulate, Detect, Investigate, Confirm, Reveal; -1 = before the story starts. */
  index: number;
  kicker: string;
  headline: string;
  body: string;
  big?: { value: string; label: string; tag: string };
}

export const CHAPTERS = ["Simulate", "Detect", "Investigate", "Confirm", "Reveal"];

export function lastToolResult<T>(events: AgentEvent[], name: string): T | null {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].type === "tool_result" && events[i].name === name) return events[i].result as T;
  return null;
}

const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

export function chapterFor(s: S, searchM: number | null): Chapter {
  const net = s.network;
  const sensors = s.scenario?.sensors.length ?? net?.default_sensors.length ?? 0;
  const det = s.detection;
  const visits = s.agent.cleared.length + (s.agent.foundAt ? 1 : 0);

  if (s.reveal) {
    const r = s.reveal;
    const firstRank = (s.initialDetection?.candidates.findIndex((c) => c.node === r.true_leak_node) ?? -1) + 1;
    return {
      index: 4,
      kicker: "Reveal",
      headline: `The truth: node ${r.true_leak_node}.`,
      body:
        visits > 0
          ? `Ranked #${firstRank > 0 ? firstRank : "?"} at detection, #${r.rank_of_truth} after field feedback. Fetched only now, so the ranking was judged blind.`
          : `Ranked #${r.rank_of_truth}. Fetched only now, so the ranking was judged blind.`,
      big: { value: `${r.hop_error_top1}`, label: r.hop_error_top1 === 1 ? "hop from the top guess" : "hops from the top guess", tag: "simulated" },
    };
  }
  if (s.agent.state === "resolved" && s.agent.foundAt) {
    const lps = s.initialDetection?.candidates.find((c) => c.node === s.agent.foundAt)?.est_leak_lps ?? 0;
    return {
      index: 3,
      kicker: "Confirm",
      headline: `Leak confirmed at node ${s.agent.foundAt}.`,
      body: `Found in ${visits} crew visit${visits === 1 ? "" : "s"}. The search cloud collapses to a single junction.`,
      big: { value: `${Math.round((lps * 86400) / 1000).toLocaleString()} m³`, label: "of water saved per day once repaired", tag: "simulated estimate" },
    };
  }
  if (s.agent.state === "investigating" && s.agent.recommended) {
    const plan = lastToolResult<{ total_length_m: number }>(s.agent.events, "plan_inspection");
    if (s.agent.cleared.length) {
      const last = s.agent.cleared[s.agent.cleared.length - 1];
      return {
        index: 3,
        kicker: "Confirm",
        headline: `Nothing at node ${last}.`,
        body: `Crews miss leaks sometimes, so node ${last} is down-weighted, not excluded. The evidence shifts; next stop: node ${s.agent.recommended}.`,
        big: searchM !== null ? { value: km(searchM), label: "of pipe still in the search", tag: "illustrative" } : undefined,
      };
    }
    return {
      index: 2,
      kicker: "Investigate",
      headline: `Crew to node ${s.agent.recommended} first.`,
      body: "The agent ranked, tested its best hypothesis against every sensor, and planned a route. Every number it uses came from a tool.",
      big: plan ? { value: km(plan.total_length_m), label: "planned crew route", tag: "simulated" } : undefined,
    };
  }
  if (s.agent.state === "abstained") {
    return {
      index: 2,
      kicker: "Investigate",
      headline: "Not enough evidence to send a crew.",
      body: s.agent.recommended ? `One more sensor at node ${s.agent.recommended} would separate the leading candidates.` : "AquaTrace will not dispatch on a guess.",
    };
  }
  if (det?.status === "insufficient_evidence") {
    const ratio = det.evidence.noise_floor > 0 ? det.evidence.residual_norm / det.evidence.noise_floor : 0;
    return {
      index: 1,
      kicker: "Detect",
      headline: "The signal is below the noise floor.",
      body: `AquaTrace refuses to guess.${det.recommended_sensor ? ` Adding a sensor at node ${det.recommended_sensor} would tell the leaders apart.` : ""}`,
      big: { value: `${ratio.toFixed(1)}×`, label: "signal vs noise floor", tag: "simulated" },
    };
  }
  if (det) {
    return {
      index: 1,
      kicker: "Detect",
      headline: `${det.evidence.live_sensors ?? sensors} sensors felt the drop.`,
      body: `Their pattern matches a leak near ${det.candidates.slice(0, 3).map((c) => c.node).join(", ")}. The glow is the search area, drawn from relative scores along the real pipes.`,
      big: searchM !== null ? { value: km(searchM), label: "of pipe to walk instead of the whole network", tag: "illustrative" } : undefined,
    };
  }
  if (s.scenario) {
    return {
      index: 0,
      kicker: "Simulate",
      headline: "A leak is hidden somewhere.",
      body: `Nobody knows where, not even this screen. ${sensors} pressure sensors are listening.`,
    };
  }
  const total = net ? net.pipes.reduce((a, p) => a + p.length, 0) : 0;
  return {
    index: -1,
    kicker: "AquaTrace",
    headline: "Find the leak, not the guess.",
    body: `${net?.nodes.filter((n) => n.type === "junction").length ?? 92} junctions, ${sensors} pressure sensors, one hidden leak.`,
    big: total ? { value: km(total), label: "of pipe in this network", tag: "network data" } : undefined,
  };
}
