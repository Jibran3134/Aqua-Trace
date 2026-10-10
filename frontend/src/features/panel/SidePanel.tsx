import { BarChart3, Bot, Lock, MapPin, Radio, Wrench } from "lucide-react";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { useStore, type TabId } from "../../state/store";
import { cn } from "../../ui/primitives";
import { AgentTab } from "../agent/AgentTab";
import { CandidatesTab } from "../candidates/CandidatesTab";
import { EvaluationTab } from "../evaluation/EvaluationTab";
import { RepairsTab } from "../repairs/RepairsTab";
import { SensorsTab } from "../sensors/SensorsTab";


const TABS: { id: TabId; label: string; icon: ReactNode; ready: boolean; stage?: string }[] = [
  { id: "candidates", label: "Candidates", icon: <MapPin className="size-4" />, ready: true },
  { id: "agent", label: "Agent", icon: <Bot className="size-4" />, ready: true },
  { id: "evaluation", label: "Evaluation", icon: <BarChart3 className="size-4" />, ready: true },
  { id: "sensors", label: "Sensors", icon: <Radio className="size-4" />, ready: true },
  { id: "repairs", label: "Repairs", icon: <Wrench className="size-4" />, ready: true },
];

export function SidePanel() {
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const active = TABS.find((t) => t.id === tab)!;
  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-ink-600/70 bg-gradient-to-b from-ink-850/95 to-ink-900/95 shadow-lift">
      <nav role="tablist" className="flex shrink-0 gap-1 border-b border-ink-700 p-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            aria-label={t.label}
            title={`${t.label} (${TABS.indexOf(t) + 1})`}
            onClick={() => setTab(t.id)}
            className={cn(
              "relative flex items-center justify-center gap-1 rounded-xl py-2 text-[0.8rem] font-semibold transition-colors",
              t.ready ? "min-w-0 flex-1 px-2" : "flex-none px-1.5",
              tab === t.id ? "text-limestone" : "text-silt hover:text-limestone-dim",
            )}
          >
            {tab === t.id && (
              <motion.span layoutId="tab-pill" className="absolute inset-0 rounded-xl bg-ink-700/80 ring-1 ring-ink-500/60" transition={{ type: "spring", stiffness: 400, damping: 34 }} />
            )}
            <span className="relative flex items-center gap-1.5">
              {t.icon}
              {/* Locked stretch tabs stay icon-only so the live ones fit at 1280px. */}
              {t.ready && <span className="hidden lg:inline">{t.label}</span>}
              {!t.ready && <Lock className="size-3 text-silt-dim" />}
            </span>
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "candidates" && <CandidatesTab />}
        {tab === "agent" && <AgentTab />}
        {tab === "evaluation" && <EvaluationTab />}
        {tab === "sensors" && <SensorsTab />}
        {tab === "repairs" && <RepairsTab />}
        {!active.ready && <ComingSoon label={active.label} stage={active.stage!} />}
      </div>
    </aside>
  );
}

function ComingSoon({ label, stage }: { label: string; stage: string }) {
  return (
    <div className="grid h-full place-items-center text-center">
      <div>
        <Lock className="mx-auto size-6 text-silt-dim" />
        <div className="mt-2 font-display text-lg font-semibold">{label}</div>
        <p className="mt-1 text-[0.85rem] text-silt">Lands in {stage}.</p>
      </div>
    </div>
  );
}
