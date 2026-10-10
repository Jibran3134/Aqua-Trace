import { ArrowRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { USE_MOCKS } from "../api/client";
import { ease } from "../ui/motion";
import { AquaTraceMark, Badge, Button, Kbd, cn } from "../ui/primitives";

// three.js lives in its own chunk: the console never pays for it.
const NetworkScene = lazy(() => import("../features/intro/NetworkScene"));

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/** If the GPU path fails for any reason, the intro still works as a flat page. */
class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Three beats (plan W10): problem → approach → promise. Qualitative only: no unsourced statistics. */
const BEATS = [
  {
    kicker: "The problem",
    title: (
      <>
        Treated water,
        <br />
        <span className="text-verdigris-bright">lost underground.</span>
      </>
    ),
    body: "Leaks hide inside buried pipes. Crews dig where they guess, and every wrong guess costs a day of water and a day of work.",
  },
  {
    kicker: "The approach",
    title: (
      <>
        A few sensors
        <br />
        <span className="text-phosphor">can hear it.</span>
      </>
    ),
    body: "A leak bends the pressure across the whole network. Six loggers are enough to match that pattern against every junction.",
  },
  {
    kicker: "Leak localization for water utilities",
    title: (
      <>
        Find the leak,
        <br />
        <span className="bg-gradient-to-r from-saffron to-vermilion bg-clip-text text-transparent">not the guess.</span>
      </>
    ),
    body: "A physics-based signature match, an investigator agent that plans the crew route, and the honesty to say when the evidence is not enough.",
  },
];
const BEAT_MS = 4800;
const DIVE_MS = 1300;

export function IntroPage({ onEnter }: { onEnter: () => void }) {
  const gl = useMemo(() => webglAvailable(), []);
  const still = useMemo(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false, []);
  const [beat, setBeat] = useState(still ? 2 : 0);
  const [diving, setDiving] = useState(false);

  // Enter: the camera dives to top-down, the page fades to the map's background, then the console.
  const enter = useCallback(() => {
    if (diving) return;
    if (!gl || still) return onEnter();
    setBeat(2);
    setDiving(true);
    window.setTimeout(onEnter, DIVE_MS);
  }, [diving, gl, still, onEnter]);

  // Auto-advance through the first two beats; the last one waits for the presenter.
  useEffect(() => {
    if (beat >= 2 || diving) return;
    const t = window.setTimeout(() => setBeat((b) => b + 1), BEAT_MS);
    return () => window.clearTimeout(t);
  }, [beat, diving]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") enter();
      else if (["ArrowRight", " ", "PageDown"].includes(e.key)) {
        e.preventDefault();
        if (beat < 2) setBeat((x) => Math.min(2, x + 1));
        else enter();
      } else if (e.key === "ArrowLeft") setBeat((b) => Math.max(0, b - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [beat, enter]);

  const b = BEATS[beat];

  return (
    <div className="relative h-full overflow-hidden bg-ink-950">
      <div className="absolute inset-0">
        {gl ? (
          <SceneBoundary>
            <Suspense fallback={null}>
              <NetworkScene still={still} beat={beat} dive={diving} />
            </Suspense>
          </SceneBoundary>
        ) : (
          <div className="aquifer-bg" />
        )}
      </div>

      {/* Beat 1: the real-world anchor, duotoned into the palette (Unsplash, credited below). */}
      <AnimatePresence>
        {beat === 0 && !diving && (
          <motion.div
            key="photo"
            className="absolute inset-y-0 right-0 w-[58%] overflow-hidden"
            initial={{ opacity: 0, scale: 1.06 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.03 }}
            transition={{ duration: 1.1, ease: ease.out }}
          >
            <img src="/img/intro-pipe.webp" alt="Water pouring from a pipe set in a stone wall" className="size-full object-cover object-[50%_45%] grayscale" />
            <div className="absolute inset-0 bg-[#1f7f70] mix-blend-color" />
            <div className="absolute inset-0 bg-gradient-to-r from-ink-950 via-ink-950/40 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-ink-950 to-transparent" />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-ink-950 via-ink-950/70 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-ink-950 to-transparent" />

      <motion.div
        className="relative z-10 flex h-full flex-col justify-between px-6 py-8 sm:px-12 sm:py-10"
        animate={{ opacity: diving ? 0 : 1 }}
        transition={{ duration: 0.45 }}
      >
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <AquaTraceMark className="size-10" />
            <span className="font-display text-xl font-bold tracking-tight">
              Aqua<span className="text-verdigris">Trace</span>
            </span>
          </div>
          {USE_MOCKS && (
            <Badge tone="saffron" dot>
              MOCK ENGINE · offline demo
            </Badge>
          )}
        </header>

        <div className="max-w-xl">
          <AnimatePresence mode="wait">
            <motion.div
              key={beat}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.55, ease: ease.out }}
            >
              <div className="font-mono text-[0.8rem] uppercase tracking-[0.22em] text-verdigris-bright">{b.kicker}</div>
              <h1 className="mt-3 font-display text-[clamp(2.4rem,5.5vw,4.4rem)] font-bold leading-[1.02] tracking-tight">{b.title}</h1>
              <p className="mt-5 max-w-md text-[1.08rem] leading-relaxed text-limestone-dim">{b.body}</p>
            </motion.div>
          </AnimatePresence>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Button tone="primary" size="lg" icon={<ArrowRight className="size-5" />} onClick={enter} autoFocus>
              Enter the console
            </Button>
            <span className="text-[0.86rem] text-silt">
              <Kbd>Enter</Kbd> to start · <Kbd>→</Kbd> next
            </span>
          </div>

          <div className="mt-7 flex gap-2" role="tablist" aria-label="Intro beats">
            {BEATS.map((x, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={beat === i}
                aria-label={x.kicker}
                onClick={() => setBeat(i)}
                className="relative h-1.5 w-12 overflow-hidden rounded-full bg-ink-700"
              >
                {/* Keyed by state: a skipped beat snaps full instead of finishing its slow fill. */}
                <motion.span
                  key={i < beat ? "done" : i === beat ? "current" : "todo"}
                  className={cn("absolute inset-y-0 left-0 rounded-full", i <= beat ? "bg-verdigris" : "bg-transparent")}
                  initial={{ width: i < beat || (i === beat && (beat === 2 || still)) ? "100%" : "0%" }}
                  animate={{ width: i <= beat ? "100%" : "0%" }}
                  transition={{ duration: i === beat && beat < 2 && !still ? BEAT_MS / 1000 : 0, ease: "linear" }}
                />
              </button>
            ))}
          </div>
        </div>

        <footer className="flex flex-wrap items-end justify-between gap-3 text-[0.8rem] text-silt">
          <span>
            Network: EPANET Net3 (benchmark stand-in) · heights from real node elevations
            {beat === 0 && " · Photo: Jacob Vathikulam / Unsplash"}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-vermilion" /> pulse and sensors are decorative; real scenarios keep the leak hidden until Reveal
          </span>
        </footer>
      </motion.div>

      {/* Dive hand-off: fade to the map background so the console appears in place. */}
      <motion.div className="pointer-events-none absolute inset-0 bg-ink-950" initial={false} animate={{ opacity: diving ? 1 : 0 }} transition={{ delay: (DIVE_MS - 380) / 1000, duration: 0.35 }} />
    </div>
  );
}
