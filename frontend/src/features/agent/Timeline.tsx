import { Brain, CheckCircle2, ChevronRight, CircleSlash, MapPin, TerminalSquare, Wrench } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { AgentEvent } from "../../contracts/types";
import { cn } from "../../ui/primitives";

const REVEAL_MS = 400;

const KIND: Record<AgentEvent["type"], { icon: React.ReactNode; dot: string; label: string }> = {
  thought: { icon: <Brain className="size-3.5" />, dot: "bg-ink-600 text-limestone-dim", label: "Thought" },
  tool_call: { icon: <Wrench className="size-3.5" />, dot: "bg-verdigris-deep text-verdigris-bright", label: "Tool call" },
  tool_result: { icon: <TerminalSquare className="size-3.5" />, dot: "bg-ink-700 text-silt", label: "Result" },
  recommendation: { icon: <MapPin className="size-3.5" />, dot: "bg-verdigris text-ink-950", label: "Recommendation" },
  abstain: { icon: <CircleSlash className="size-3.5" />, dot: "bg-saffron text-ink-950", label: "Needs more evidence" },
  final: { icon: <CheckCircle2 className="size-3.5" />, dot: "bg-verdigris-bright text-ink-950", label: "Resolved" },
};

/** Reveals new events one by one so a live audience can follow the agent's reasoning. */
export function Timeline({ events: all, onSettled, compact = false }: { events: AgentEvent[]; onSettled?: (settled: boolean) => void; compact?: boolean }) {
  // Summary view keeps the agent's reasoning and outcomes; tool calls stay one click away.
  const events = compact ? all.filter((e) => e.type !== "tool_call" && e.type !== "tool_result") : all;
  const [revealed, setRevealed] = useState(0);
  // Derived, not synced: if the event list shrinks (new scenario) we simply show fewer.
  const shown = Math.min(revealed, events.length);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (shown >= events.length) {
      onSettled?.(true);
      return;
    }
    onSettled?.(false);
    const t = setTimeout(() => setRevealed(shown + 1), shown === 0 ? 120 : REVEAL_MS);
    return () => clearTimeout(t);
  }, [shown, events.length, onSettled]);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [shown]);

  // Leaving the tab mid-animation must not leave presenter cues waiting forever.
  useEffect(() => () => onSettled?.(true), [onSettled]);

  return (
    <ol className="relative space-y-2 pl-1">
      <span className="absolute bottom-3 left-[13px] top-3 w-px bg-gradient-to-b from-ink-600 via-ink-600 to-transparent" />
      <AnimatePresence initial={false}>
        {events.slice(0, shown).map((e, i) => (
          <motion.li
            key={i}
            initial={{ opacity: 0, x: -10, filter: "blur(4px)" }}
            animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.32, ease: [0.2, 0.7, 0.2, 1] }}
            className="relative flex gap-3"
          >
            <span className={cn("relative z-10 mt-0.5 grid size-[26px] shrink-0 place-items-center rounded-full ring-4 ring-ink-900", KIND[e.type].dot)}>
              {KIND[e.type].icon}
            </span>
            <div className="min-w-0 flex-1 pb-1">
              <EventBody e={e} />
            </div>
          </motion.li>
        ))}
      </AnimatePresence>
      <div ref={end} />
    </ol>
  );
}

function EventBody({ e }: { e: AgentEvent }) {
  const [open, setOpen] = useState(false);
  switch (e.type) {
    case "thought":
      return <p className="pt-1 text-[0.88rem] italic text-limestone-dim">{e.text}</p>;
    case "tool_call":
      return (
        <div className="pt-0.5">
          <span className="num text-[0.86rem] font-semibold text-verdigris-bright">{e.name}</span>
          <span className="num text-[0.8rem] text-silt">({formatArgs(e.args)})</span>
        </div>
      );
    case "tool_result":
      return (
        <div className="pt-0.5">
          <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-[0.8rem] text-silt hover:text-limestone" aria-expanded={open}>
            <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
            <span className="num">{summarize(e)}</span>
          </button>
          {open && (
            <pre className="num mt-1.5 max-h-56 overflow-auto rounded-lg bg-ink-950/70 p-2.5 text-[0.8rem] leading-relaxed text-limestone-dim ring-1 ring-ink-700">
              {JSON.stringify(e.result, null, 2)}
            </pre>
          )}
        </div>
      );
    case "recommendation":
      return <p className="rounded-xl bg-verdigris/10 px-3 py-2 text-[0.9rem] text-limestone ring-1 ring-verdigris/40">{e.text}</p>;
    case "abstain":
      return <p className="rounded-xl bg-saffron/10 px-3 py-2 text-[0.9rem] text-limestone ring-1 ring-saffron/40">{e.text}</p>;
    case "final":
      return <p className="rounded-xl bg-verdigris-bright/10 px-3 py-2 text-[0.9rem] font-medium text-limestone ring-1 ring-verdigris-bright/50">{e.text}</p>;
  }
}

function formatArgs(args?: Record<string, unknown>): string {
  if (!args) return "";
  return Object.entries(args)
    .map(([k, v]) => `${k}=${Array.isArray(v) ? `[${v.join(", ")}]` : JSON.stringify(v)}`)
    .join(", ");
}

/** One-line digest of a tool result; the full JSON stays one click away. */
function summarize(e: AgentEvent): string {
  const r = e.result as Record<string, unknown> | undefined;
  if (!r || typeof r !== "object") return "result";
  if (e.name === "rank_candidates" && Array.isArray(r.candidates)) {
    return `${(r.candidates as { node: string }[]).map((c) => c.node).join(", ")} · ${String(r.status)}`;
  }
  if (e.name === "simulate_hypothesis") return `fit ${String(r.fit_label)} · rmse ${String(r.rmse)} m`;
  if (e.name === "plan_inspection" && Array.isArray(r.order)) return `${(r.order as string[]).join(" → ")} · ${String(r.total_length_m)} m`;
  if (e.name === "recommend_sensor_addition") return r.recommended ? `add sensor at ${String(r.recommended)}` : "no sensor needed";
  if (e.name === "record_field_result") return r.closed ? "investigation closed" : "ranking updated";
  return "result";
}
