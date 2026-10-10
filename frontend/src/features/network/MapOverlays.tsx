import { AnimatePresence, motion } from "motion/react";
import { normalizeToTop, rampColor } from "../../lib/score";
import { useStore } from "../../state/store";
import { cn } from "../../ui/primitives";

export type Project = (id: string) => { x: number; y: number } | null;

/**
 * HTML markers drawn over either map engine (Cytoscape or deck.gl): rank pills, truth crosshair,
 * crew target, FIX markers, sensor suggestion. Each engine only supplies screen projection.
 */
export function MapOverlays({ project }: { project: Project }) {
  const detection = useStore((s) => s.detection);
  const reveal = useStore((s) => s.reveal);
  const agent = useStore((s) => s.agent);
  const tab = useStore((s) => s.tab);
  const repair = useStore((s) => s.repair);

  // Planning tabs (sensors, repairs) are about the whole network: hide the live scenario's markers.
  const scenarioLayer = tab !== "sensors" && tab !== "repairs";
  const tops = scenarioLayer && detection?.status === "ok" ? detection.candidates.slice(0, 3) : [];
  // Rank pills sit up-right of their node; adjacent candidates would collide, so stack them.
  const placed: { x: number; y: number }[] = [];
  const pills = tops.map((c) => {
    const p = project(c.node);
    if (!p) return null;
    let dy = 0;
    while (placed.some((q) => Math.abs(q.x - p.x) < 78 && Math.abs(q.y - (p.y + dy)) < 26)) dy -= 26;
    placed.push({ x: p.x, y: p.y + dy });
    return { p, dy };
  });

  return (
      <div className="pointer-events-none absolute inset-0">
        <AnimatePresence>
          {tops.map((c, i) => {
            const pill = pills[i];
            if (!pill) return null;
            const { p, dy } = pill;
            const color = rampColor(normalizeToTop(c.score, tops[0].score));
            return (
              <motion.div
                key={`${c.node}-${i}`}
                initial={{ opacity: 0, scale: 0.4 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.4 }}
                transition={{ delay: i * 0.12, type: "spring", stiffness: 260, damping: 20 }}
                className="absolute"
                style={{ left: p.x, top: p.y }}
              >
                {i === 0 && !reveal && agent.state === "idle" && (
                  <>
                    <span className="absolute -left-6 -top-6 size-12 animate-ripple rounded-full" style={{ boxShadow: `0 0 0 2px ${color}` }} />
                    <span className="absolute -left-6 -top-6 size-12 animate-ripple rounded-full [animation-delay:1.2s]" style={{ boxShadow: `0 0 0 2px ${color}` }} />
                  </>
                )}
                {dy !== 0 && <span className="absolute left-[6px] w-px bg-limestone/40" style={{ top: dy - 14, height: -dy + 6 }} />}
                <span
                  className="num absolute left-[8px] flex h-6 items-center gap-1 whitespace-nowrap rounded-full pl-1 pr-2 text-[0.8rem] font-bold text-ink-950 shadow-lg ring-2 ring-ink-950"
                  style={{ background: color, top: dy - 30 }}
                >
                  <span className="grid size-[18px] place-items-center rounded-full bg-ink-950/25">{i + 1}</span>
                  {c.node}
                </span>
              </motion.div>
            );
          })}
          {scenarioLayer &&
            reveal &&
            (() => {
              const p = project(reveal.true_leak_node);
              if (!p) return null;
              return (
                <motion.div
                  key="truth"
                  className="absolute"
                  style={{ left: p.x, top: p.y }}
                  initial={{ opacity: 0, scale: 2.4 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: "spring", stiffness: 140, damping: 14 }}
                >
                  <span className="absolute -left-7 -top-7 size-14 rounded-full border-2 border-tracer shadow-glow-tracer" />
                  <span className="absolute -left-7 -top-7 size-14 animate-ripple rounded-full border-2 border-tracer" />
                  <span className="absolute -left-[1px] -top-10 h-6 w-0.5 bg-tracer" />
                  <span className="absolute -left-[1px] top-4 h-6 w-0.5 bg-tracer" />
                  <span className="absolute -left-10 -top-[1px] h-0.5 w-6 bg-tracer" />
                  <span className="absolute left-4 -top-[1px] h-0.5 w-6 bg-tracer" />
                  <span className="absolute -left-12 top-8 whitespace-nowrap rounded-md bg-tracer px-2 py-0.5 font-mono text-[0.8rem] font-bold text-ink-950 shadow-glow-tracer">
                    TRUE LEAK · {reveal.true_leak_node}
                  </span>
                </motion.div>
              );
            })()}
          {scenarioLayer &&
            agent.state === "investigating" &&
            agent.recommended &&
            (() => {
              const p = project(agent.recommended);
              if (!p) return null;
              return (
                <motion.div
                  key={`inspect-${agent.recommended}`}
                  className="absolute"
                  style={{ left: p.x, top: p.y }}
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ type: "spring", stiffness: 220, damping: 16 }}
                >
                  <span className="absolute -left-7 -top-7 size-14 animate-ripple rounded-full border-2 border-verdigris-bright" />
                  <span className="absolute -left-5 -top-5 size-10 rounded-full border-2 border-verdigris-bright shadow-glow-verdigris" />
                  <span className="absolute -left-10 top-6 whitespace-nowrap rounded-md bg-verdigris-bright px-2 py-0.5 font-mono text-[0.8rem] font-bold text-ink-950">
                    CREW → {agent.recommended}
                  </span>
                </motion.div>
              );
            })()}
          {tab === "repairs" &&
            repair?.selected.map((r) => {
              const p = project(r.node);
              if (!p) return null;
              return (
                <motion.div key={`fix-${r.node}`} className="absolute" style={{ left: p.x, top: p.y }} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                  <span className="absolute -left-5 -top-5 size-10 rounded-full border-2 border-verdigris-bright shadow-glow-verdigris" />
                  <span className="absolute left-3 -top-8 whitespace-nowrap rounded-md bg-verdigris-bright px-1.5 py-0.5 font-mono text-[0.8rem] font-bold text-ink-950">
                    FIX · {r.node}
                  </span>
                </motion.div>
              );
            })}
          {scenarioLayer &&
            agent.foundAt &&
            (() => {
              const p = project(agent.foundAt);
              if (!p) return null;
              return (
                <motion.div key={`found-${agent.foundAt}`} className="absolute" style={{ left: p.x, top: p.y }} initial={{ opacity: 0, scale: 1.8 }} animate={{ opacity: 1, scale: 1 }}>
                  <span className="absolute -left-6 -top-6 size-12 rounded-full border-[3px] border-vermilion shadow-glow-vermilion" />
                  <span className="absolute -left-12 -top-12 whitespace-nowrap rounded-md bg-vermilion px-2 py-0.5 font-mono text-[0.8rem] font-bold text-ink-950">
                    CREW: LEAK FOUND
                  </span>
                </motion.div>
              );
            })()}
          {scenarioLayer &&
            (detection?.recommended_sensor || (agent.state === "abstained" && agent.recommended)) &&
            (() => {
              const p = project(detection?.recommended_sensor ?? agent.recommended!);
              if (!p) return null;
              return (
                <motion.div key="suggest" className="absolute" style={{ left: p.x, top: p.y }} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <span className="absolute -left-6 -top-6 size-12 animate-ripple rounded-full border-2 border-dashed border-phosphor" />
                  <span className="absolute left-5 top-2 whitespace-nowrap rounded-md bg-phosphor/90 px-2 py-0.5 text-[0.8rem] font-bold text-ink-950">
                    + add sensor
                  </span>
                </motion.div>
              );
            })()}
        </AnimatePresence>
      </div>
  );
}

export function MapButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn("grid size-9 place-items-center rounded-xl bg-ink-850/90 text-limestone-dim ring-1 ring-ink-600 backdrop-blur transition hover:text-limestone hover:ring-verdigris/60")}
    >
      {children}
    </button>
  );
}
