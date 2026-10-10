import { Crosshair } from "lucide-react";
import { motion } from "motion/react";
import { useStore } from "../../state/store";
import { Prov } from "../../ui/primitives";

export function RevealCard() {
  const reveal = useStore((s) => s.reveal);
  const flyTo = useStore((s) => s.flyTo);
  if (!reveal) return null;
  const hit1 = reveal.rank_of_truth === 1;
  const hit3 = reveal.rank_of_truth > 0 && reveal.rank_of_truth <= 3;
  const verdict = hit1 ? "Top candidate was the leak." : hit3 ? `Truth was in the top 3 (rank ${reveal.rank_of_truth}).` : `Truth ranked ${reveal.rank_of_truth > 0 ? `#${reveal.rank_of_truth}` : "outside the list"}.`;

  return (
    <motion.div
      initial={{ opacity: 0, rotateX: -18, y: -10 }}
      animate={{ opacity: 1, rotateX: 0, y: 0 }}
      transition={{ type: "spring", stiffness: 160, damping: 18 }}
      style={{ transformPerspective: 800 }}
      className="overflow-hidden rounded-2xl bg-gradient-to-br from-tracer/20 via-tracer/[0.06] to-transparent p-4 ring-1 ring-tracer/50 shadow-glow-tracer"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-tracer">
          <Crosshair className="size-5" />
          <span className="font-display text-lg font-bold">Truth revealed</span>
        </div>
        <Prov kind="simulated" />
      </div>
      <button type="button" onClick={() => flyTo(reveal.true_leak_node)} className="mt-2 text-left">
        <span className="text-[0.86rem] text-silt">Leak was at </span>
        <span className="num text-xl font-bold text-tracer">node {reveal.true_leak_node}</span>
        <span className="text-[0.86rem] text-silt"> · {reveal.true_size} leak</span>
      </button>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Metric label="rank of truth" value={reveal.rank_of_truth > 0 ? `#${reveal.rank_of_truth}` : "–"} good={hit3} />
        <Metric label="hop error (top 1)" value={`${reveal.hop_error_top1} hop${reveal.hop_error_top1 === 1 ? "" : "s"}`} good={reveal.hop_error_top1 <= 1} />
      </div>
      <p className="mt-2 text-[0.84rem] text-limestone-dim">{verdict}</p>
    </motion.div>
  );
}

function Metric({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div className="rounded-xl bg-ink-950/50 px-3 py-2 ring-1 ring-ink-700">
      <div className="text-[0.72rem] text-silt">{label}</div>
      <div className={`num text-lg font-bold ${good ? "text-verdigris-bright" : "text-saffron"}`}>{value}</div>
    </div>
  );
}
