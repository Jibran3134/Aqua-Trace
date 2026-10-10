import { ArrowRight, Keyboard, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { useStore, type TabId } from "../../state/store";
import { Kbd } from "../../ui/primitives";

interface Action {
  label: string;
  key: string;
  run: () => void;
}

/** The single most sensible next move for the presenter, derived from app state. */
function useNextAction(): Action | null {
  const s = useStore();
  if (s.busy || s.narrating || !s.network) return null;
  if (!s.scenario) return { label: "Simulate a hidden leak", key: "S", run: () => s.simulate() };
  if (!s.detection) return { label: "Detect candidates", key: "D", run: s.detect };
  if (s.detection.status === "insufficient_evidence" && s.detection.recommended_sensor) {
    const rec = s.detection.recommended_sensor;
    return { label: `Add sensor ${rec} and re-run`, key: "A", run: () => s.simulate({ seed: s.scenario!.seed, sensors: [...s.scenario!.sensors, rec] }) };
  }
  if (s.detection.status === "ok" && s.agent.state === "idle") return { label: "Investigate with the agent", key: "I", run: s.investigate };
  if (s.agent.state === "investigating" && s.agent.recommended) return { label: `Send crew to node ${s.agent.recommended}`, key: "C", run: () => s.reportField("crew") };
  if (!s.reveal) return { label: "Reveal the truth", key: "V", run: s.revealTruth };
  if (s.tab !== "evaluation") return { label: "Show the evaluation", key: "3", run: () => s.setTab("evaluation") };
  return { label: "Plan sensors", key: "4", run: () => s.setTab("sensors") };
}

const TABS: TabId[] = ["candidates", "agent", "evaluation", "sensors", "repairs"];

/** Global presenter shortcuts. Ignored while typing in a field. */
export function usePresenterKeys(toggleHelp: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (e.ctrlKey || e.metaKey || e.altKey || t?.closest("input, select, textarea, [contenteditable]")) return;
      const s = useStore.getState();
      const key = e.key.toLowerCase();
      if (key === "?" || (key === "/" && e.shiftKey)) return toggleHelp();
      if (/^[1-5]$/.test(key)) return s.setTab(TABS[Number(key) - 1]);
      if (key === "p" && s.initialDetection) return s.setReport(!s.reportOpen);
      if (key === "t") return s.toggleTheme();
      if (key === "f") return s.setPresent(!s.present);
      if (s.busy) return;
      if (key === "s") void s.simulate();
      else if (key === "d") void s.detect();
      else if (key === "i") void s.investigate();
      else if (key === "c") void s.reportField("crew");
      else if (key === "v" && s.detection && !s.reveal) void s.revealTruth();
      else if (key === "a" && s.detection?.recommended_sensor && s.scenario) {
        void s.simulate({ seed: s.scenario.seed, sensors: [...s.scenario.sensors, s.detection.recommended_sensor] });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleHelp]);
}

export function NextStepChip() {
  const next = useNextAction();
  return (
    <div className="absolute bottom-3 right-3 z-20">
      <AnimatePresence mode="wait">
        {next && (
          <motion.button
            key={next.label}
            type="button"
            onClick={next.run}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="group flex items-center gap-2 rounded-xl bg-ink-850/90 py-2 pl-3 pr-2 text-[0.84rem] text-limestone ring-1 ring-verdigris/40 backdrop-blur transition hover:ring-verdigris"
          >
            <span className="font-mono text-[0.8rem] uppercase tracking-[0.16em] text-verdigris-bright">Next</span>
            <span>{next.label}</span>
            <Kbd>{next.key}</Kbd>
            <ArrowRight className="size-4 text-verdigris-bright transition group-hover:translate-x-0.5" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ["S", "Simulate hidden leak"],
  ["D", "Detect candidates"],
  ["A", "Add recommended sensor & re-run"],
  ["I", "Investigate with the agent"],
  ["C", "Send simulated crew"],
  ["V", "Reveal truth"],
  ["F", "Present mode"],
  ["T", "Projector / dark theme"],
  ["P", "Investigation report"],
  ["R", "Reset map view"],
  ["1–5", "Switch tabs"],
  ["?", "Show / hide this sheet"],
];

export function HelpButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Keyboard shortcuts (?)"
      aria-label="Keyboard shortcuts"
      className="grid size-9 place-items-center rounded-xl text-silt ring-1 ring-ink-600 transition hover:text-limestone hover:ring-ink-500"
    >
      <Keyboard className="size-4" />
    </button>
  );
}

export function HelpSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center bg-ink-950/70 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
            initial={{ scale: 0.94, y: 10 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="w-[min(420px,calc(100vw-32px))] rounded-2xl bg-ink-850 p-5 shadow-lift ring-1 ring-ink-600"
          >
            <div className="flex items-center justify-between">
              <div className="font-display text-lg font-bold">Presenter shortcuts</div>
              <button type="button" aria-label="Close" onClick={onClose} className="text-silt hover:text-limestone">
                <X className="size-5" />
              </button>
            </div>
            <ul className="mt-3 space-y-1.5">
              {SHORTCUTS.map(([k, d]) => (
                <li key={k} className="flex items-center justify-between text-[0.9rem]">
                  <span className="text-limestone-dim">{d}</span>
                  <Kbd>{k}</Kbd>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[0.8rem] text-silt">Shortcuts are ignored while typing in a field. The “Next” chip on the map always shows the next step.</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
