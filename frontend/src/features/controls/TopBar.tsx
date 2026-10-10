import { Check, Eye, HardHat, Monitor, Moon, Radar, Search, Sun, Waves } from "lucide-react";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { API_URL, USE_MOCKS } from "../../api/client";
import { useStore } from "../../state/store";
import { spring } from "../../ui/motion";
import { AquaTraceMark, Badge, cn } from "../../ui/primitives";
import { HelpButton } from "../presenter/Presenter";
import { ScenarioPopover } from "./ScenarioPopover";

type StepState = "done" | "current" | "locked";

interface Step {
  n: number;
  label: string;
  icon: ReactNode;
  state: StepState;
  run?: () => void;
  busy?: boolean;
}

/** The demo's five beats as the app's primary navigation (plan W5). */
function useSteps(): Step[] {
  const s = useStore();
  const ok = s.detection?.status === "ok";
  const started = s.agent.events.length > 0;
  const resolved = s.agent.state === "resolved";
  const idle = !s.busy && !!s.network && s.health?.signatures_ready !== false;

  const raw: Omit<Step, "state">[] = [
    { n: 1, label: "Simulate", icon: <Waves className="size-4" />, run: () => s.simulate(), busy: s.busy === "simulate" },
    { n: 2, label: "Detect", icon: <Radar className="size-4" />, run: s.scenario ? s.detect : undefined, busy: s.busy === "detect" },
    { n: 3, label: "Investigate", icon: <Search className="size-4" />, run: ok && !started ? s.investigate : undefined, busy: s.busy === "agent" },
    {
      n: 4,
      label: "Confirm",
      icon: <HardHat className="size-4" />,
      run: s.agent.state === "investigating" && s.agent.recommended ? () => s.reportField("crew") : undefined,
      busy: s.busy === "field",
    },
    { n: 5, label: "Reveal", icon: <Eye className="size-4" />, run: s.detection && !s.reveal ? s.revealTruth : undefined, busy: s.busy === "reveal" },
  ];
  const done = [!!s.scenario, !!s.detection, started, resolved, !!s.reveal];
  // Current = first step not done; with insufficient evidence the story jumps to Reveal.
  let current = done.findIndex((d) => !d);
  if (s.detection && !ok && current === 2) current = 4;
  return raw.map((r, i) => ({
    ...r,
    run: idle ? r.run : undefined,
    state: done[i] && i !== current ? "done" : i === current ? "current" : "locked",
  }));
}

export function TopBar() {
  const steps = useSteps();
  const setHelp = useStore((s) => s.setHelp);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const setPresent = useStore((s) => s.setPresent);

  return (
    <header className="relative z-20 flex h-[68px] shrink-0 items-center gap-3 border-b border-ink-700/80 bg-ink-950/75 px-4 backdrop-blur-md">
      <a href="#/intro" className="flex shrink-0 items-center gap-2 pr-1" title="Back to intro">
        <AquaTraceMark className="size-9" />
        <span className="hidden font-display text-[1.25rem] font-bold tracking-tight 2xl:inline">
          Aqua<span className="text-verdigris">Trace</span>
        </span>
      </a>

      <nav aria-label="Investigation steps" className="mx-auto flex min-w-0 items-center">
        {steps.map((st, i) => (
          <div key={st.n} className="flex items-center">
            {i > 0 && (
              <span className="relative mx-1 h-0.5 w-4 overflow-hidden rounded-full bg-ink-700 2xl:w-8">
                <motion.span
                  className="absolute inset-y-0 left-0 bg-verdigris"
                  initial={false}
                  animate={{ width: steps[i - 1].state === "done" ? "100%" : "0%" }}
                  transition={{ duration: 0.5 }}
                />
              </span>
            )}
            <StepPill step={st} />
          </div>
        ))}
      </nav>

      <div className="flex shrink-0 items-center gap-1.5">
        <ScenarioPopover />
        <IconBtn label="Present mode (F)" onClick={() => setPresent(true)}>
          <Monitor className="size-4" />
        </IconBtn>
        <IconBtn label={theme === "dark" ? "Projector theme (T)" : "Dark theme (T)"} onClick={toggleTheme}>
          {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </IconBtn>
        <HelpButton onClick={() => setHelp(true)} />
        {USE_MOCKS ? (
          <Badge tone="saffron" dot className="whitespace-nowrap">
            MOCK
          </Badge>
        ) : (
          <Badge tone="verdigris" dot className="whitespace-nowrap">
            LIVE · {API_URL.replace(/^https?:\/\//, "")}
          </Badge>
        )}
      </div>
    </header>
  );
}

function StepPill({ step }: { step: Step }) {
  const actionable = !!step.run && step.state !== "locked";
  return (
    <motion.button
      type="button"
      layout
      transition={spring.ui}
      disabled={!actionable}
      onClick={step.run}
      aria-current={step.state === "current" ? "step" : undefined}
      className={cn(
        "relative flex h-10 items-center gap-2 whitespace-nowrap rounded-full pl-1.5 pr-3 text-[0.92rem] font-semibold transition-colors",
        step.state === "current" && actionable && "bg-verdigris text-ink-950 shadow-glow-verdigris hover:bg-verdigris-bright",
        step.state === "current" && !actionable && "bg-ink-800 text-limestone ring-1 ring-verdigris/60",
        step.state === "done" && "text-limestone-dim hover:bg-ink-800",
        step.state === "locked" && "text-silt-dim",
        actionable ? "cursor-pointer" : "cursor-default",
      )}
    >
      {step.state === "current" && actionable && !step.busy && (
        <span className="pointer-events-none absolute inset-0 animate-ripple rounded-full ring-2 ring-verdigris/60 [animation-duration:2.8s]" />
      )}
      <span
        className={cn(
          "num grid size-7 place-items-center rounded-full text-[0.8rem] font-bold",
          step.state === "done" && "bg-verdigris/20 text-verdigris-bright",
          step.state === "current" && (actionable ? "bg-ink-950/20" : "bg-verdigris/20 text-verdigris-bright"),
          step.state === "locked" && "bg-ink-800 text-silt-dim",
        )}
      >
        {step.busy ? (
          <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : step.state === "done" ? (
          <Check className="size-4" />
        ) : (
          step.icon
        )}
      </span>
      {step.label}
    </motion.button>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="grid size-9 place-items-center rounded-xl text-silt ring-1 ring-ink-600 transition hover:text-limestone hover:ring-ink-500"
    >
      {children}
    </button>
  );
}
