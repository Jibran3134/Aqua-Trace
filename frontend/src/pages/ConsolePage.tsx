import { CloudOff, Hourglass, RotateCcw } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect } from "react";
import { TopBar } from "../features/controls/TopBar";
import { NetworkCanvas } from "../features/network/NetworkCanvas";
import { HelpSheet, NextStepChip, usePresenterKeys } from "../features/presenter/Presenter";
import { InvestigationReport } from "../features/report/InvestigationReport";
import { SidePanel } from "../features/panel/SidePanel";
import { useStore } from "../state/store";
import { ErrorBoundary } from "../ui/ErrorBoundary";
import { Button, Panel, Spinner } from "../ui/primitives";

export function ConsolePage() {
  const network = useStore((s) => s.network);
  const networkError = useStore((s) => s.networkError);
  const health = useStore((s) => s.health);
  const loadNetwork = useStore((s) => s.loadNetwork);
  const pollHealth = useStore((s) => s.pollHealth);
  const helpOpen = useStore((s) => s.helpOpen);
  const setHelp = useStore((s) => s.setHelp);
  const toggleHelp = useCallback(() => setHelp(!useStore.getState().helpOpen), [setHelp]);
  const closeHelp = useCallback(() => setHelp(false), [setHelp]);
  usePresenterKeys(toggleHelp);

  useEffect(() => {
    void loadNetwork();
    void pollHealth();
  }, [loadNetwork, pollHealth]);

  // While the backend builds its signature library, poll and show progress instead of failing.
  const building = health?.signatures_ready === false;
  useEffect(() => {
    if (!building) return;
    const t = setInterval(() => void pollHealth(), 1500);
    return () => clearInterval(t);
  }, [building, pollHealth]);

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div className="aquifer-bg" />
      <div className="aquifer-grain" />
      <TopBar />

      <AnimatePresence>
        {building && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="relative z-10 overflow-hidden border-b border-saffron/30 bg-saffron/[0.08]"
          >
            <div className="flex items-center gap-3 px-5 py-2 text-[0.88rem]">
              <Hourglass className="size-4 animate-pulse text-saffron" />
              <span className="text-limestone-dim">
                Building the leak signature library (one simulation per junction). Simulate unlocks when it's done.
              </span>
              <div className="ml-auto h-1.5 w-48 overflow-hidden rounded-full bg-ink-700">
                <motion.div className="h-full bg-saffron" animate={{ width: `${Math.round((health?.progress ?? 0) * 100)}%` }} />
              </div>
              <span className="num w-10 text-right text-saffron">{Math.round((health?.progress ?? 0) * 100)}%</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="relative z-10 grid min-h-0 flex-1 grid-cols-[minmax(0,65fr)_minmax(0,35fr)] gap-3 p-3">
        <section className="relative min-h-0">
          {network ? (
            <ErrorBoundary area="map">
              <NetworkCanvas />
              <NextStepChip />
            </ErrorBoundary>
          ) : networkError ? (
            <div className="grid h-full place-items-center">
              <Panel className="max-w-md p-6 text-center">
                <CloudOff className="mx-auto size-8 text-vermilion" />
                <div className="mt-2 font-display text-xl font-bold">Can't load the network</div>
                <p className="mt-1 text-[0.9rem] text-limestone-dim">{networkError.message}</p>
                <p className="mt-1 text-[0.85rem] text-silt">{networkError.hint}</p>
                <Button tone="primary" className="mt-4" icon={<RotateCcw className="size-4" />} onClick={() => void loadNetwork()}>
                  Retry
                </Button>
              </Panel>
            </div>
          ) : (
            <div className="grid h-full place-items-center rounded-2xl border border-ink-600/70 text-silt">
              <div className="flex items-center gap-3">
                <Spinner className="text-verdigris" /> Loading Net3 network…
              </div>
            </div>
          )}
        </section>
        <section className="min-h-0">
          <ErrorBoundary area="panel">
            <SidePanel />
          </ErrorBoundary>
        </section>
      </main>
      <HelpSheet open={helpOpen} onClose={closeHelp} />
      <InvestigationReport />
    </div>
  );
}
