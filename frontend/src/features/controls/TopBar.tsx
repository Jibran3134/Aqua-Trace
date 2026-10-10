import { Eye, Radar, Waves } from "lucide-react";
import type { ReactNode } from "react";
import { API_URL, USE_MOCKS } from "../../api/client";
import type { LeakSize, NoiseLevel } from "../../contracts/types";
import { useStore } from "../../state/store";
import { AquaTraceMark, Badge, Button, cn } from "../../ui/primitives";

const field =
  "h-10 rounded-xl bg-ink-850 px-3 text-[0.9rem] text-limestone ring-1 ring-ink-600 outline-none transition focus:ring-2 focus:ring-verdigris/70 disabled:opacity-50";

export function TopBar() {
  const controls = useStore((s) => s.controls);
  const setControls = useStore((s) => s.setControls);
  const busy = useStore((s) => s.busy);
  const scenario = useStore((s) => s.scenario);
  const detection = useStore((s) => s.detection);
  const reveal = useStore((s) => s.reveal);
  const network = useStore((s) => s.network);
  const health = useStore((s) => s.health);
  const simulate = useStore((s) => s.simulate);
  const detect = useStore((s) => s.detect);
  const revealTruth = useStore((s) => s.revealTruth);

  const notReady = !network || health?.signatures_ready === false;
  const locked = busy !== null;

  return (
    <header className="relative z-20 flex h-[68px] shrink-0 items-center gap-4 border-b border-ink-700/80 bg-ink-950/70 px-5 backdrop-blur-md">
      <div className="flex items-center gap-2.5 pr-2">
        <AquaTraceMark className="size-9" />
        <div className="leading-tight">
          <div className="font-display text-[1.3rem] font-bold tracking-tight">
            Aqua<span className="text-verdigris">Trace</span>
          </div>
          <div className="font-mono text-[0.58rem] uppercase tracking-[0.2em] text-silt">leak localization</div>
        </div>
      </div>

      <div className="mx-1 h-8 w-px bg-ink-700" />

      <div className="flex items-end gap-2">
        <Field label="Seed">
          <input
            className={cn(field, "num w-[5.5rem]")}
            placeholder="random"
            inputMode="numeric"
            value={controls.seed}
            disabled={locked}
            onChange={(e) => setControls({ seed: e.target.value.replace(/[^\d]/g, "").slice(0, 7) })}
            onKeyDown={(e) => e.key === "Enter" && simulate()}
            aria-label="Scenario seed (blank for random)"
          />
        </Field>
        <Field label="Leak size">
          <select className={cn(field, "w-[6.6rem]")} value={controls.size} disabled={locked} onChange={(e) => setControls({ size: e.target.value as LeakSize | "random" })}>
            <option value="random">random</option>
            <option value="small">small</option>
            <option value="medium">medium</option>
            <option value="large">large</option>
          </select>
        </Field>
        <Field label="Noise">
          <select className={cn(field, "w-[5.4rem]")} value={controls.noise} disabled={locked} onChange={(e) => setControls({ noise: e.target.value as NoiseLevel })}>
            <option value="low">low</option>
            <option value="mid">mid</option>
            <option value="high">high</option>
          </select>
        </Field>
        <Field label="Sensors">
          <select className={cn(field, "w-[4.6rem]")} value={controls.k} disabled={locked} onChange={(e) => setControls({ k: Number(e.target.value) })}>
            {[3, 6, 10].map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="ml-1 flex items-center gap-2">
        <Step n={1} done={!!scenario}>
          <Button tone="primary" loading={busy === "simulate"} disabled={notReady || locked} icon={<Waves className="size-4" />} onClick={() => simulate()}>
            Simulate leak
          </Button>
        </Step>
        <Step n={2} done={!!detection}>
          <Button
            tone={scenario && !detection ? "primary" : "ghost"}
            loading={busy === "detect"}
            disabled={!scenario || locked}
            icon={<Radar className="size-4" />}
            onClick={detect}
          >
            Detect
          </Button>
        </Step>
        <Step n={3} done={!!reveal}>
          <Button tone="tracer" loading={busy === "reveal"} disabled={!detection || !!reveal || locked} icon={<Eye className="size-4" />} onClick={revealTruth}>
            Reveal
          </Button>
        </Step>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {USE_MOCKS ? (
          <Badge tone="saffron" dot className="whitespace-nowrap">
            MOCK ENGINE
          </Badge>
        ) : (
          <Badge tone="verdigris" dot className="whitespace-nowrap" >
            LIVE · {API_URL.replace(/^https?:\/\//, "")}
          </Badge>
        )}
      </div>
    </header>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="pl-1 font-mono text-[0.58rem] uppercase tracking-[0.16em] text-silt">{label}</span>
      {children}
    </label>
  );
}

function Step({ n, done, children }: { n: number; done: boolean; children: ReactNode }) {
  return (
    <div className="relative">
      <span
        className={cn(
          "num absolute -left-1.5 -top-1.5 z-10 grid size-[18px] place-items-center rounded-full text-[0.62rem] font-bold ring-2 ring-ink-950 transition-colors",
          done ? "bg-verdigris text-ink-950" : "bg-ink-600 text-limestone-dim",
        )}
      >
        {n}
      </span>
      {children}
    </div>
  );
}
