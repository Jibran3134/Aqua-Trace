import { ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import { Component, Suspense, lazy, useEffect, useMemo, type ReactNode } from "react";
import { USE_MOCKS } from "../api/client";
import { AquaTraceMark, Badge, Button, Kbd } from "../ui/primitives";

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

const STATS = [
  ["92", "junctions"],
  ["6", "pressure sensors"],
  ["1", "hidden leak"],
];

export function IntroPage({ onEnter }: { onEnter: () => void }) {
  const gl = useMemo(webglAvailable, []);
  const still = useMemo(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Enter" && onEnter();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEnter]);

  return (
    <div className="relative h-full overflow-hidden bg-ink-950">
      <div className="absolute inset-0">
        {gl ? (
          <SceneBoundary>
            <Suspense fallback={null}>
              <NetworkScene still={still} />
            </Suspense>
          </SceneBoundary>
        ) : (
          <div className="aquifer-bg" />
        )}
      </div>
      {/* Legibility scrim: text sits on the left third, the network breathes on the right. */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-ink-950 via-ink-950/75 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-ink-950 to-transparent" />

      <div className="relative z-10 flex h-full flex-col justify-between px-6 py-8 sm:px-12 sm:py-10">
        <motion.header initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between">
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
        </motion.header>

        <div className="max-w-xl">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.7 }}>
            <div className="font-mono text-[0.72rem] uppercase tracking-[0.22em] text-verdigris-bright">Leak localization for water utilities</div>
            <h1 className="mt-3 font-display text-[clamp(2.4rem,5.5vw,4.4rem)] font-bold leading-[1.02] tracking-tight">
              Find the leak,
              <br />
              <span className="bg-gradient-to-r from-saffron to-vermilion bg-clip-text text-transparent">not the guess.</span>
            </h1>
            <p className="mt-5 max-w-md text-[1.05rem] leading-relaxed text-limestone-dim">
              A handful of pressure sensors, a physics-based signature match, and an investigator agent that plans the crew route and says so when the evidence is not enough.
            </p>
          </motion.div>

          <motion.dl initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 }} className="mt-7 flex gap-8">
            {STATS.map(([n, l]) => (
              <div key={l}>
                <dt className="num text-3xl font-bold text-limestone">{n}</dt>
                <dd className="text-[0.82rem] text-silt">{l}</dd>
              </div>
            ))}
          </motion.dl>

          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }} className="mt-8 flex flex-wrap items-center gap-4">
            <Button tone="primary" size="lg" icon={<ArrowRight className="size-5" />} onClick={onEnter} autoFocus>
              Enter the console
            </Button>
            <span className="text-[0.82rem] text-silt">
              or press <Kbd>Enter</Kbd>
            </span>
          </motion.div>
        </div>

        <motion.footer initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }} className="flex flex-wrap items-end justify-between gap-3 text-[0.76rem] text-silt">
          <span>Network: EPANET Net3 (benchmark stand-in) · heights from real node elevations</span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-vermilion" /> the pulse is decorative; real scenarios keep the leak hidden until Reveal
          </span>
        </motion.footer>
      </div>
    </div>
  );
}
