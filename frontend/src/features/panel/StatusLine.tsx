import { AnimatePresence, motion } from "motion/react";
import { useStore } from "../../state/store";
import { dur, ease } from "../../ui/motion";

/** One plain sentence that says where the investigation stands (plan W5). Data-only, no guesses. */
export function useStatusSentence(): { tone: "idle" | "work" | "good" | "warn" | "truth"; text: string } {
  const s = useStore();
  const visits = s.agent.cleared.length + (s.agent.foundAt ? 1 : 0);
  if (s.busy === "simulate") return { tone: "work", text: "Injecting a hidden leak…" };
  if (s.busy === "detect") return { tone: "work", text: "Matching the pressure pattern…" };
  if (s.busy === "agent") return { tone: "work", text: "The agent is planning…" };
  if (s.busy === "field") return { tone: "work", text: `Crew inspecting node ${s.agent.recommended}…` };
  if (s.reveal) {
    const r = s.reveal.rank_of_truth;
    return { tone: "truth", text: `Truth: node ${s.reveal.true_leak_node}${r > 0 ? `, ranked #${r}` : ""}.` };
  }
  if (s.agent.state === "resolved") return { tone: "good", text: `Leak confirmed at node ${s.agent.foundAt} in ${visits} visit${visits === 1 ? "" : "s"}.` };
  if (s.agent.state === "investigating" && s.agent.recommended) return { tone: "work", text: `Crew heading to node ${s.agent.recommended} · visit ${visits + 1}.` };
  if (s.agent.state === "abstained") return { tone: "warn", text: "Not enough evidence to send a crew." };
  if (s.detection?.status === "insufficient_evidence") return { tone: "warn", text: "Signal below the noise floor. No guess." };
  if (s.detection) return { tone: "good", text: `Search narrowed to ${Math.min(3, s.detection.candidates.length)} junctions.` };
  if (s.scenario) return { tone: "idle", text: `A leak is hidden. ${s.scenario.sensors.length} sensors are listening.` };
  return { tone: "idle", text: "No scenario yet. Simulate a hidden leak." };
}

const DOT = { idle: "bg-silt", work: "bg-saffron animate-pulse", good: "bg-verdigris", warn: "bg-saffron", truth: "bg-tracer" };

export function StatusLine() {
  const { tone, text } = useStatusSentence();
  return (
    <div className="flex min-h-[3.25rem] items-center gap-2.5 border-b border-ink-700 px-4 py-2.5" role="status" aria-live="polite">
      <span className={`size-2.5 shrink-0 rounded-full ${DOT[tone]}`} />
      <AnimatePresence mode="wait">
        <motion.span
          key={text}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: dur.ui, ease: ease.out }}
          className="font-display text-[1.12rem] font-semibold leading-tight tracking-tight"
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}
