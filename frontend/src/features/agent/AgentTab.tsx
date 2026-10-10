import { Bot, Eye, HardHat, PartyPopper, Play, RotateCcw, SearchX, Siren } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useState } from "react";
import { useStore } from "../../state/store";
import { Badge, Button, Eyebrow, Prov } from "../../ui/primitives";
import { Timeline } from "./Timeline";

export function AgentTab() {
  const scenario = useStore((s) => s.scenario);
  const agent = useStore((s) => s.agent);
  const busy = useStore((s) => s.busy);
  const investigate = useStore((s) => s.investigate);
  const [settled, setSettled] = useState(true);
  const onSettled = useCallback((v: boolean) => setSettled(v), []);

  if (!scenario) {
    return (
      <Intro>
        <p className="text-[0.9rem] text-silt">Simulate a hidden leak first. The agent works on the current scenario.</p>
      </Intro>
    );
  }

  if (agent.state === "idle" && !agent.events.length) {
    return (
      <Intro>
        <Button tone="primary" size="lg" className="mt-5 w-full" loading={busy === "agent"} disabled={busy !== null} icon={<Play className="size-5" />} onClick={investigate}>
          Investigate
        </Button>
      </Intro>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <Eyebrow>Investigator agent</Eyebrow>
          <div className="mt-0.5 flex items-center gap-2">
            <span className="font-display text-lg font-bold">Tool trace</span>
            {agent.source && (agent.source === "llm" ? <Badge tone="verdigris">LLM agent</Badge> : <Badge tone="saffron">Scripted mode</Badge>)}
          </div>
        </div>
        <div className="text-right">
          <div className="num text-xl font-bold text-limestone">{agent.cleared.length + (agent.foundAt ? 1 : 0)}</div>
          <div className="text-[0.7rem] text-silt">inspections used</div>
        </div>
      </div>

      <Timeline events={agent.events} onSettled={onSettled} />

      {busy === "agent" && (
        <div className="mt-2 flex items-center gap-2 pl-10 text-[0.82rem] text-silt">
          <span className="size-2 animate-pulse rounded-full bg-verdigris" /> agent thinking…
        </div>
      )}

      {/* In flow (not sticky) so it never hides the newest events; it scrolls itself into view. */}
      <div className="mt-4">
        <AnimatePresence mode="wait">{settled && busy !== "agent" && <Dock key={`${agent.state}-${agent.recommended}`} />}</AnimatePresence>
      </div>
    </div>
  );
}

function Intro({ children }: { children: React.ReactNode }) {
  const tools = ["rank_candidates", "simulate_hypothesis", "plan_inspection", "record_field_result", "recommend_sensor_addition"];
  return (
    <div>
      <Eyebrow>Investigator agent</Eyebrow>
      <h2 className="mt-1 font-display text-2xl font-bold leading-tight">From ranking to a crew route</h2>
      <p className="mt-2 text-[0.9rem] text-limestone-dim">
        The agent can only call tools. Every node and number it states comes from a tool result, and every step is shown below.
      </p>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {tools.map((t) => (
          <span key={t} className="num rounded-lg bg-ink-800 px-2 py-1 text-[0.72rem] text-verdigris-bright ring-1 ring-ink-600">
            {t}
          </span>
        ))}
      </div>
      {children}
    </div>
  );
}

function Dock() {
  const agent = useStore((s) => s.agent);
  const busy = useStore((s) => s.busy);
  const reveal = useStore((s) => s.reveal);
  const reportField = useStore((s) => s.reportField);
  const investigate = useStore((s) => s.investigate);
  const revealTruth = useStore((s) => s.revealTruth);
  const flyTo = useStore((s) => s.flyTo);

  const shell = "rounded-2xl p-3.5 shadow-lift backdrop-blur scroll-mb-4";
  const motionProps = {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: 8 },
    ref: (el: HTMLDivElement | null) => el?.scrollIntoView({ behavior: "smooth", block: "end" }),
  };

  if (agent.error) {
    return (
      <motion.div {...motionProps} className={`${shell} bg-vermilion/10 ring-1 ring-vermilion/40`}>
        <div className="text-[0.88rem] font-semibold text-vermilion">{agent.error.message}</div>
        <div className="text-[0.8rem] text-silt">{agent.error.hint} Steps collected so far are kept above.</div>
        <Button tone="ghost" size="sm" className="mt-2" icon={<RotateCcw className="size-3.5" />} onClick={investigate} disabled={busy !== null}>
          Retry
        </Button>
      </motion.div>
    );
  }

  if (agent.state === "investigating" && agent.recommended) {
    return (
      <motion.div {...motionProps} className={`${shell} bg-ink-850/95 ring-1 ring-verdigris/40`}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-2">
          <button type="button" className="whitespace-nowrap text-left" onClick={() => flyTo(agent.recommended!)}>
            <span className="text-[0.8rem] text-silt">Crew dispatched to </span>
            <span className="num text-lg font-bold text-verdigris-bright">node {agent.recommended}</span>
          </button>
          {agent.routeLength !== null && (
            <span className="text-right text-[0.74rem] text-silt">
              route <span className="num text-limestone-dim">{agent.routeLength} m</span> <Prov kind="simulated" />
            </span>
          )}
        </div>
        <Button
          tone="primary"
          size="lg"
          className="mt-2.5 w-full"
          loading={busy === "field"}
          disabled={busy !== null}
          icon={<HardHat className="size-5" />}
          onClick={() => reportField("crew")}
        >
          Send simulated crew
        </Button>
        <p className="mt-1.5 text-[0.72rem] text-silt">
          The server checks this node against the hidden leak. Crews miss real leaks 5% of the time, so "nothing found" only down-weights a node.
        </p>
        <div className="mt-2.5 flex items-center gap-2 border-t border-ink-700 pt-2.5">
          <span className="text-[0.7rem] uppercase tracking-wider text-silt-dim">Manual</span>
          <Button tone="quiet" size="sm" disabled={busy !== null} icon={<SearchX className="size-3.5" />} onClick={() => reportField(false)}>
            Nothing found
          </Button>
          <Button tone="quiet" size="sm" disabled={busy !== null} icon={<Siren className="size-3.5" />} onClick={() => reportField(true)}>
            Leak found
          </Button>
        </div>
      </motion.div>
    );
  }

  if (agent.state === "resolved") {
    return (
      <motion.div {...motionProps} className={`${shell} bg-verdigris/10 ring-1 ring-verdigris/50`}>
        <div className="flex items-center gap-2">
          <PartyPopper className="size-5 text-verdigris-bright" />
          <span className="font-display text-lg font-bold">Leak confirmed by the crew</span>
        </div>
        <p className="mt-1 text-[0.84rem] text-limestone-dim">
          {reveal ? "Compare with the simulated truth on the map." : "Now check the ranking honestly against the simulated truth."}
        </p>
        {!reveal && (
          <Button tone="tracer" className="mt-2.5 w-full" loading={busy === "reveal"} disabled={busy !== null} icon={<Eye className="size-4" />} onClick={revealTruth}>
            Reveal truth
          </Button>
        )}
      </motion.div>
    );
  }

  if (agent.state === "abstained") {
    return (
      <motion.div {...motionProps} className={`${shell} bg-saffron/10 ring-1 ring-saffron/40`}>
        <div className="flex items-center gap-2">
          <Bot className="size-5 text-saffron" />
          <span className="font-display text-lg font-bold">More evidence needed</span>
        </div>
        <p className="mt-1 text-[0.84rem] text-limestone-dim">
          {agent.recommended ? (
            <>
              Add a sensor at <button className="num font-bold text-phosphor underline-offset-2 hover:underline" onClick={() => flyTo(agent.recommended!)}>node {agent.recommended}</button> before
              sending a crew. Guessing here would waste a field day.
            </>
          ) : (
            "The agent will not dispatch a crew on this evidence."
          )}
        </p>
      </motion.div>
    );
  }
  return null;
}
