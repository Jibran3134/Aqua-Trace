import { Check, Expand, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { useStore } from "../../state/store";
import { dur, ease } from "../../ui/motion";
import { Kbd, cn } from "../../ui/primitives";
import { Fingerprint } from "../evidence/Fingerprint";
import { LossTicker } from "../impact/LossTicker";
import { useNextAction } from "../presenter/Presenter";
import { CHAPTERS, chapterFor } from "./captions";

/**
 * Present mode (plan W3): the map goes full-bleed, a chapter rail shows the story, and a lower-third
 * caption plus one big number narrate each step. Clickers work: → / Space / Enter / PageDown advance.
 */
export function PresentMode() {
  const present = useStore((s) => s.present);
  const setPresent = useStore((s) => s.setPresent);
  const state = useStore();
  const next = useNextAction();
  const chapter = chapterFor(state, state.search?.meters ?? null);

  useEffect(() => {
    if (!present) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest("input, select, textarea")) return;
      if (e.key === "Escape") {
        e.preventDefault();
        setPresent(false);
      } else if (["ArrowRight", " ", "Enter", "PageDown"].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        next?.run();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [present, next, setPresent]);

  return (
    <AnimatePresence>
      {present && (
        <motion.div
          key="present"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: dur.ui }}
          className="pointer-events-none absolute inset-0 z-30"
        >
          {/* Chapter rail */}
          <div className="absolute inset-x-0 top-5 flex justify-center">
            <div className="flex items-center gap-1 rounded-full bg-ink-950/80 p-1.5 shadow-lift ring-1 ring-ink-600 backdrop-blur">
              {CHAPTERS.map((c, i) => {
                const done = i < chapter.index;
                const current = i === chapter.index;
                return (
                  <div key={c} className="flex items-center">
                    {i > 0 && <span className={cn("mx-1 h-0.5 w-6 rounded-full", done || current ? "bg-verdigris" : "bg-ink-600")} />}
                    <span
                      className={cn(
                        "flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[1rem] font-semibold transition-colors",
                        current && "bg-verdigris text-ink-950",
                        done && "text-verdigris-bright",
                        !done && !current && "text-silt",
                      )}
                    >
                      {done ? <Check className="size-4" /> : <span className="num text-[0.86rem]">{i + 1}</span>}
                      {c}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Exit + fullscreen */}
          <div className="pointer-events-auto absolute right-5 top-5 flex gap-2">
            <button
              type="button"
              aria-label="Browser fullscreen"
              title="Fullscreen"
              onClick={() => void document.documentElement.requestFullscreen?.().catch(() => undefined)}
              className="grid size-10 place-items-center rounded-xl bg-ink-900/85 text-limestone-dim ring-1 ring-ink-600 backdrop-blur hover:text-limestone"
            >
              <Expand className="size-4" />
            </button>
            <button
              type="button"
              aria-label="Exit present mode"
              onClick={() => setPresent(false)}
              className="flex h-10 items-center gap-2 rounded-xl bg-ink-900/85 px-3 text-[0.86rem] text-limestone-dim ring-1 ring-ink-600 backdrop-blur hover:text-limestone"
            >
              <X className="size-4" /> Exit <Kbd>Esc</Kbd>
            </button>
          </div>

          {/* Lower-third caption */}
          <div className="absolute bottom-6 left-6 max-w-[min(640px,calc(100%-380px))]">
            <AnimatePresence mode="wait">
              <motion.div
                key={chapter.headline}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.45, ease: ease.out }}
                className="rounded-3xl bg-ink-950/85 p-6 shadow-lift ring-1 ring-ink-600 backdrop-blur-md"
              >
                <div className="font-mono text-[0.86rem] uppercase tracking-[0.22em] text-verdigris-bright">{chapter.kicker}</div>
                <h2 className="mt-1.5 font-display text-[clamp(1.7rem,2.6vw,2.5rem)] font-bold leading-[1.08] tracking-tight">{chapter.headline}</h2>
                <p className="mt-2 text-[1.08rem] leading-relaxed text-limestone-dim">{chapter.body}</p>
                {next && (
                  <div className="mt-4 flex items-center gap-2 text-[0.92rem] text-silt">
                    <Kbd>→</Kbd> next: <span className="text-limestone">{next.label}</span>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Big number (+ evidence while investigating) */}
          <div className="absolute bottom-6 right-6 flex w-[330px] flex-col gap-3">
            {chapter.index === 2 && state.agent.state === "investigating" && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="rounded-3xl bg-ink-950/85 shadow-lift ring-1 ring-ink-600 backdrop-blur-md">
                <Fingerprint compact />
              </motion.div>
            )}
            <AnimatePresence mode="wait">
              {chapter.big && (
                <motion.div
                  key={chapter.big.value + chapter.big.label}
                  initial={{ opacity: 0, scale: 0.94 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.4, ease: ease.out }}
                  className="rounded-3xl bg-ink-950/85 p-5 shadow-lift ring-1 ring-ink-600 backdrop-blur-md"
                >
                  <div className="num text-[2.6rem] font-bold leading-none tracking-tight">{chapter.big.value}</div>
                  <div className="mt-1.5 text-[1rem] text-limestone-dim">{chapter.big.label}</div>
                  <div className="mt-1 font-mono text-[0.8rem] uppercase tracking-[0.14em] text-silt">{chapter.big.tag}</div>
                </motion.div>
              )}
            </AnimatePresence>
            {state.detectedAt && chapter.index >= 1 && (
              <div className="rounded-2xl bg-ink-950/85 px-5 py-3 shadow-lift ring-1 ring-vermilion/30 backdrop-blur-md">
                <LossTicker big />
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
