import { ChevronDown, Dice5, Hash, Waves } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { LeakSize, NoiseLevel } from "../../contracts/types";
import { DEMO_PRESETS } from "../../lib/demo";
import { useStore } from "../../state/store";
import { dur, ease } from "../../ui/motion";
import { Button, cn } from "../../ui/primitives";

const field =
  "h-10 w-full rounded-xl bg-ink-850 px-3 text-[0.92rem] text-limestone ring-1 ring-ink-600 outline-none transition focus:ring-2 focus:ring-verdigris/70 disabled:opacity-50";

/** Scenario knobs live here, out of the story's way (plan W5). */
export function ScenarioPopover() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const controls = useStore((s) => s.controls);
  const setControls = useStore((s) => s.setControls);
  const customSensors = useStore((s) => s.customSensors);
  const simulate = useStore((s) => s.simulate);
  const busy = useStore((s) => s.busy);

  const demo = DEMO_PRESETS.find((p) => p.id === controls.preset);
  const summary = demo ? demo.label : controls.preset === "custom" ? `Seed ${controls.seed || "?"}` : "Random";

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(id: string) {
    const d = DEMO_PRESETS.find((p) => p.id === id);
    if (d) setControls({ preset: id, seed: String(d.seed), size: d.size, noise: d.noise, k: d.k });
    else setControls({ preset: id, seed: id === "random" ? "" : controls.seed });
  }
  // Editing a demo's knobs turns it into a custom scenario (same seed) so the label never lies.
  const tweak = (c: Partial<typeof controls>) => setControls({ ...c, ...(demo ? { preset: "custom" } : {}) });

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-9 items-center gap-2 rounded-xl px-3 text-[0.88rem] font-semibold ring-1 transition",
          demo ? "bg-phosphor/10 text-phosphor ring-phosphor/40" : "bg-ink-850 text-limestone ring-ink-600 hover:ring-ink-500",
        )}
      >
        <span className="hidden font-mono text-[0.8rem] uppercase tracking-wider text-silt 2xl:inline">Scenario</span>
        {summary}
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="Scenario settings"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: dur.ui, ease: ease.out }}
            className="absolute right-0 top-12 z-40 w-[380px] origin-top-right rounded-2xl bg-ink-850 p-4 shadow-lift ring-1 ring-ink-600"
          >
            <div className="text-[0.8rem] font-semibold uppercase tracking-wider text-silt">Demo stories</div>
            <div className="mt-2 grid gap-2">
              {DEMO_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => pick(p.id)}
                  className={cn(
                    "rounded-xl px-3 py-2.5 text-left ring-1 transition",
                    controls.preset === p.id ? "bg-phosphor/10 ring-phosphor/50" : "bg-ink-900 ring-ink-700 hover:ring-ink-500",
                  )}
                >
                  <div className="flex items-baseline justify-between">
                    <span className="font-display text-[1.02rem] font-bold">{p.label}</span>
                    <span className="num text-[0.8rem] text-silt">seed {p.seed}</span>
                  </div>
                  <div className="text-[0.86rem] text-limestone-dim">{p.story}</div>
                </button>
              ))}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => pick("random")}
                  className={cn("flex items-center gap-2 rounded-xl px-3 py-2 text-[0.9rem] ring-1", controls.preset === "random" ? "bg-ink-700 ring-ink-500" : "bg-ink-900 ring-ink-700")}
                >
                  <Dice5 className="size-4" /> Random
                </button>
                <button
                  type="button"
                  onClick={() => pick("custom")}
                  className={cn("flex items-center gap-2 rounded-xl px-3 py-2 text-[0.9rem] ring-1", controls.preset === "custom" ? "bg-ink-700 ring-ink-500" : "bg-ink-900 ring-ink-700")}
                >
                  <Hash className="size-4" /> Custom seed
                </button>
              </div>
              {controls.preset === "custom" && (
                <input
                  className={cn(field, "num")}
                  placeholder="seed, e.g. 1000"
                  inputMode="numeric"
                  value={controls.seed}
                  autoFocus
                  aria-label="Scenario seed"
                  onChange={(e) => setControls({ seed: e.target.value.replace(/[^\d]/g, "").slice(0, 7) })}
                />
              )}
            </div>

            <div className="mt-4 text-[0.8rem] font-semibold uppercase tracking-wider text-silt">Conditions</div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <Labeled label="Leak size">
                <select className={field} value={controls.size} onChange={(e) => tweak({ size: e.target.value as LeakSize | "random" })}>
                  <option value="random">random</option>
                  <option value="small">small</option>
                  <option value="medium">medium</option>
                  <option value="large">large</option>
                </select>
              </Labeled>
              <Labeled label="Noise">
                <select className={field} value={controls.noise} onChange={(e) => tweak({ noise: e.target.value as NoiseLevel })}>
                  <option value="low">low</option>
                  <option value="mid">mid</option>
                  <option value="high">high</option>
                </select>
              </Labeled>
              <Labeled label="Sensors">
                {customSensors ? (
                  <div className={cn(field, "num flex items-center text-phosphor")} title="Optimized set from the Sensors tab">
                    opt·{customSensors.length}
                  </div>
                ) : (
                  <select className={field} value={controls.k} onChange={(e) => tweak({ k: Number(e.target.value) })}>
                    {[3, 6, 10].map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                )}
              </Labeled>
            </div>

            <Button
              tone="primary"
              size="lg"
              className="mt-4 w-full"
              disabled={busy !== null}
              icon={<Waves className="size-5" />}
              onClick={() => {
                setOpen(false);
                void simulate();
              }}
            >
              Simulate this scenario
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[0.8rem] text-silt">{label}</span>
      {children}
    </label>
  );
}
