import { BarChart3, Bot, Lock, MapPin, Radio, Wrench } from "lucide-react";
import { motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { cn } from "../../ui/primitives";
import { CandidatesTab } from "../candidates/CandidatesTab";

type TabId = "candidates" | "agent" | "evaluation" | "sensors" | "repairs";

const TABS: { id: TabId; label: string; icon: ReactNode; ready: boolean; stage?: string }[] = [
  { id: "candidates", label: "Candidates", icon: <MapPin className="size-4" />, ready: true },
  { id: "agent", label: "Agent", icon: <Bot className="size-4" />, ready: false, stage: "MVP-1" },
  { id: "evaluation", label: "Evaluation", icon: <BarChart3 className="size-4" />, ready: false, stage: "MVP-1" },
  { id: "sensors", label: "Sensors", icon: <Radio className="size-4" />, ready: false, stage: "S1" },
  { id: "repairs", label: "Repairs", icon: <Wrench className="size-4" />, ready: false, stage: "S2" },
];

export function SidePanel() {
  const [tab, setTab] = useState<TabId>("candidates");
  const active = TABS.find((t) => t.id === tab)!;
  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-ink-600/70 bg-gradient-to-b from-ink-850/95 to-ink-900/95 shadow-lift">
      <nav role="tablist" className="flex shrink-0 gap-1 border-b border-ink-700 p-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "relative flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-[0.8rem] font-semibold transition-colors",
              tab === t.id ? "text-limestone" : "text-silt hover:text-limestone-dim",
            )}
          >
            {tab === t.id && (
              <motion.span layoutId="tab-pill" className="absolute inset-0 rounded-xl bg-ink-700/80 ring-1 ring-ink-500/60" transition={{ type: "spring", stiffness: 400, damping: 34 }} />
            )}
            <span className="relative flex items-center gap-1.5">
              {t.icon}
              <span className="hidden xl:inline">{t.label}</span>
              {!t.ready && <Lock className="size-3 text-silt-dim" />}
            </span>
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {active.ready ? <CandidatesTab /> : <ComingSoon label={active.label} stage={active.stage!} />}
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
