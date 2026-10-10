import { motion } from "motion/react";
import { lastToolResult } from "../present/captions";
import { useStore } from "../../state/store";
import { ease } from "../../ui/motion";
import { cn } from "../../ui/primitives";
import { palette } from "../../ui/tokens";

interface Hypothesis {
  node: string;
  per_sensor: { sensor: string; observed: number; predicted: number }[];
  rmse: number;
  fit_label: string;
}

const STAMP: Record<string, string> = {
  good: "text-verdigris-bright ring-verdigris/60",
  fair: "text-saffron ring-saffron/60",
  poor: "text-vermilion ring-vermilion/60",
};

/**
 * "Why this node?" (plan W4): at each sensor, the observed pressure change next to what a leak at the
 * hypothesis node would produce. When the bars interlock, the signature matches. Data: the
 * simulate_hypothesis tool result, unchanged.
 */
export function Fingerprint({ compact = false }: { compact?: boolean }) {
  const events = useStore((s) => s.agent.events);
  const theme = useStore((s) => s.theme);
  const h = lastToolResult<Hypothesis>(events, "simulate_hypothesis");
  if (!h || !h.per_sensor?.length) return null;
  const pal = palette(theme);
  const max = Math.max(0.01, ...h.per_sensor.flatMap((r) => [Math.abs(r.observed), Math.abs(r.predicted)]));
  const pct = (v: number) => `${(Math.abs(v) / max) * 50}%`;

  return (
    <div className={cn("rounded-2xl bg-ink-950/50 ring-1 ring-ink-700", compact ? "p-3" : "p-3.5")}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-mono text-[0.8rem] uppercase tracking-[0.14em] text-silt">Signature match</div>
          <div className="font-display text-[1.05rem] font-bold leading-tight">
            Leak at node <span className="num text-verdigris-bright">{h.node}</span>?
          </div>
        </div>
        <motion.div
          initial={{ scale: 1.6, rotate: -14, opacity: 0 }}
          animate={{ scale: 1, rotate: -6, opacity: 1 }}
          transition={{ delay: 0.5, type: "spring", stiffness: 260, damping: 14 }}
          className={cn("rounded-lg px-2 py-0.5 font-mono text-[0.86rem] font-bold uppercase ring-2", STAMP[h.fit_label] ?? STAMP.fair)}
        >
          fit {h.fit_label}
        </motion.div>
      </div>

      <div className="mt-2.5 space-y-1.5" role="img" aria-label={`Observed versus predicted pressure change at ${h.per_sensor.length} sensors for a leak at node ${h.node}`}>
        {h.per_sensor.map((r, i) => (
          <div key={r.sensor} className="grid grid-cols-[2.6rem_1fr_3.4rem] items-center gap-2">
            <span className="num text-[0.8rem] text-phosphor">{r.sensor}</span>
            <div className="relative h-[18px]">
              <span className="absolute inset-y-0 left-1/2 w-px bg-ink-500" />
              {/* observed (solid) above, predicted (hatched) below: interlock = match */}
              <motion.span
                className="absolute top-0 h-[8px] rounded-[3px]"
                style={{ background: pal.chartMethod, [r.observed < 0 ? "right" : "left"]: "50%" }}
                initial={{ width: 0 }}
                animate={{ width: pct(r.observed) }}
                transition={{ delay: 0.1 + i * 0.06, duration: 0.6, ease: ease.out }}
              />
              <motion.span
                className="absolute bottom-0 h-[8px] rounded-[3px]"
                style={{
                  background: `repeating-linear-gradient(45deg, ${pal.chartBaseline} 0 3px, color-mix(in oklab, ${pal.chartBaseline} 40%, transparent) 3px 6px)`,
                  [r.predicted < 0 ? "right" : "left"]: "50%",
                }}
                initial={{ width: 0 }}
                animate={{ width: pct(r.predicted) }}
                transition={{ delay: 0.25 + i * 0.06, duration: 0.6, ease: ease.out }}
              />
            </div>
            <span className="num text-right text-[0.8rem] text-limestone-dim">{r.observed.toFixed(2)} m</span>
          </div>
        ))}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8rem] text-silt">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-3.5 rounded-sm" style={{ background: pal.chartMethod }} /> observed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-3.5 rounded-sm" style={{ background: `repeating-linear-gradient(45deg, ${pal.chartBaseline} 0 2px, transparent 2px 4px)` }} /> predicted
        </span>
        <span>
          rmse <span className="num text-limestone-dim">{h.rmse} m</span> · simulated
        </span>
      </div>
    </div>
  );
}
