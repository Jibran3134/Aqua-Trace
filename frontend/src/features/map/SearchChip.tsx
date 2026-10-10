import { AnimatePresence, motion } from "motion/react";
import { useCallback, useState } from "react";
import { AnimatedNumber } from "../../ui/AnimatedNumber";
import { dur, ease } from "../../ui/motion";

/** "How much pipe would a crew have to walk?" — shrinks as the search cloud collapses (plan W2). */
export function SearchChip({ search }: { search: { meters: number; pinpointed: string | null } | null }) {
  const fmt = useCallback((v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} km` : `${Math.round(v)} m`), []);
  // Trend vs the previous value, so the presenter can say "it narrowed" or "it spread" truthfully.
  // Previous-value-in-state pattern: adjust during render, no effect.
  const meters = search?.meters ?? null;
  const [track, setTrack] = useState<{ last: number | null; trend: "up" | "down" | null }>({ last: meters, trend: null });
  if (meters !== track.last) {
    setTrack({ last: meters, trend: meters === null || track.last === null ? null : meters > track.last ? "up" : "down" });
  }
  const trend = track.trend;
  return (
    <AnimatePresence>
      {search !== null && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: dur.ui, ease: ease.out }}
          className="pointer-events-none absolute left-3 top-3 z-10 rounded-2xl bg-ink-900/85 px-4 py-2.5 shadow-lift ring-1 ring-ink-600 backdrop-blur"
        >
          <div className="font-mono text-[0.8rem] uppercase tracking-[0.14em] text-silt">Search area</div>
          {search.pinpointed ? (
            <div className="flex items-baseline gap-2">
              <span className="font-display text-[1.6rem] font-bold leading-tight text-vermilion">Pinpointed</span>
              <span className="num text-[0.92rem] text-limestone-dim">node {search.pinpointed}</span>
            </div>
          ) : (
            <div className="flex items-baseline gap-2">
              <AnimatedNumber value={search.meters} format={fmt} className="num text-[1.6rem] font-bold leading-tight text-limestone" />
              <span className="text-[0.86rem] text-silt">of pipe to walk</span>
              {trend && (
                <span className={`num text-[0.86rem] font-semibold ${trend === "down" ? "text-verdigris-bright" : "text-saffron"}`}>
                  {trend === "down" ? "▼ narrowed" : "▲ spread"}
                </span>
              )}
            </div>
          )}
          <div className="text-[0.8rem] text-silt">{search.pinpointed ? "crew-confirmed" : "illustrative · from relative scores"}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
