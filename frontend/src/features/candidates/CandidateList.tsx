import { Info } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { normalizeToTop, rampColor } from "../../lib/score";
import { useStore } from "../../state/store";
import { Eyebrow, Prov, cn } from "../../ui/primitives";

const TIE_COLORS = ["#6fe0c7", "#d4f26a", "#f2b33d", "#e8e2d0"];
/** Below this top1/top2 ratio the ranking is shown with an explicit "search area" caveat. */
const WEAK_SEPARATION = 1.05;

export function CandidateList() {
  const detection = useStore((s) => s.detection);
  const reveal = useStore((s) => s.reveal);
  const focus = useStore((s) => s.focusNode);
  const flyTo = useStore((s) => s.flyTo);
  const setHover = useStore((s) => s.setHover);
  const [more, setMore] = useState(false);
  if (!detection) return null; // can briefly be null while this view animates out
  const top = detection.candidates[0]?.score ?? 0;

  if (!detection.candidates.length) {
    return <div className="rounded-xl p-4 text-center text-silt ring-1 ring-ink-700">No candidates returned. Try more sensors or lower noise.</div>;
  }

  return (
    <div>
      <div className="flex items-end justify-between">
        <div>
          <Eyebrow>Ranked leak candidates</Eyebrow>
          <h2 className="mt-0.5 font-display text-xl font-bold">Inspect these first</h2>
        </div>
        <Prov kind="relative score" />
      </div>
      {detection.evidence.margin_top1_vs_top2 < WEAK_SEPARATION && (
        <div className="mt-3 flex gap-2 rounded-xl bg-saffron/[0.07] px-3 py-2 text-[0.8rem] text-limestone-dim ring-1 ring-saffron/30">
          <Info className="mt-0.5 size-4 shrink-0 text-saffron" />
          <span>
            <b className="text-saffron">Weak separation.</b> The leaders are nearly indistinguishable (top1/top2{" "}
            <span className="num">{detection.evidence.margin_top1_vs_top2.toFixed(2)}×</span>). Treat them as a search area, not a pinpoint.
          </span>
        </div>
      )}
      <ul className="mt-3 space-y-1.5">
        {detection.candidates.slice(0, more ? undefined : 3).map((c, i) => {
          const t = normalizeToTop(c.score, top);
          const color = rampColor(t);
          const isTruth = reveal?.true_leak_node === c.node;
          const lead = i < 3;
          return (
            <motion.li
              key={c.node}
              layout
              initial={{ opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05, type: "spring", stiffness: 300, damping: 28 }}
            >
              <button
                type="button"
                onClick={() => flyTo(c.node)}
                onMouseEnter={() => setHover(c.node)}
                onMouseLeave={() => setHover(null)}
                className={cn(
                  "group grid w-full grid-cols-[2rem_1fr_auto] items-center gap-3 rounded-xl px-3 text-left transition",
                  lead ? "py-2.5" : "py-1.5",
                  focus === c.node ? "bg-ink-700/80 ring-1 ring-ink-500" : "hover:bg-ink-800",
                  isTruth && "ring-2 ring-tracer shadow-glow-tracer",
                )}
                style={c.tie_group ? { boxShadow: `inset 3px 0 0 ${TIE_COLORS[(c.tie_group - 1) % TIE_COLORS.length]}` } : undefined}
              >
                <span
                  className={cn("num grid place-items-center rounded-full font-bold", lead ? "size-8 text-[0.85rem] text-ink-950" : "size-6 text-[0.8rem] text-silt ring-1 ring-ink-600")}
                  style={lead ? { background: color } : undefined}
                >
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span className="flex items-baseline gap-2">
                    <span className={cn("num font-bold", lead ? "text-[1.05rem]" : "text-[0.9rem] text-limestone-dim")}>Node {c.node}</span>
                    {isTruth && <span className="rounded bg-tracer px-1.5 text-[0.8rem] font-bold text-ink-950">TRUE LEAK</span>}
                    {c.tie_group && <span className="text-[0.8rem] text-silt">near-tie</span>}
                  </span>
                  <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-ink-700">
                    <motion.span
                      className="block h-full rounded-full"
                      style={{ background: color }}
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.max(3, t * 100)}%` }}
                      transition={{ delay: 0.15 + i * 0.05, duration: 0.6, ease: [0.2, 0.7, 0.2, 1] }}
                    />
                  </span>
                  {lead && (
                    <span className="mt-1 block truncate text-[0.8rem] text-silt">
                      ≈<span className="num text-limestone-dim">{c.est_leak_lps.toFixed(1)} L/s</span> · pipes {c.adjacent_pipes.join(", ")}
                    </span>
                  )}
                </span>
                <span className="num text-right text-[0.9rem]" style={{ color: lead ? color : undefined }}>
                  {c.score.toFixed(3)}
                </span>
              </button>
            </motion.li>
          );
        })}
      </ul>
      {detection.candidates.length > 3 && (
        <button type="button" onClick={() => setMore((m) => !m)} className="mt-1.5 w-full rounded-xl py-1.5 text-[0.86rem] text-silt hover:bg-ink-800 hover:text-limestone">
          {more ? "Show top 3 only" : `+${detection.candidates.length - 3} more candidates`}
        </button>
      )}
      <p className="mt-2 text-[0.8rem] text-silt">Scores are relative · flows are simulated estimates</p>
      {detection.candidates.some((c) => c.tie_group) && (
        <p className="mt-2 text-[0.8rem] text-silt">Candidates sharing a colored edge are within 1% of each other: neighbors with near-identical signatures.</p>
      )}
    </div>
  );
}
