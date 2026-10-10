import { CheckCircle2, CircleDashed, FlaskConical, Play, ShieldCheck, XCircle } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";
import { ApiError, API_URL, USE_MOCKS, api } from "../api/client";
import { rampColor } from "../lib/score";
import { AquaTraceMark, Badge, Button, Eyebrow, Kbd, Panel, Prov, RippleDot } from "../ui/primitives";

const SWATCHES = [
  { name: "Aquifer ink", token: "ink-950", hex: "#071316", role: "Canvas. Water column at depth." },
  { name: "Basin", token: "ink-900", hex: "#0C1F23", role: "Panels and surfaces." },
  { name: "Limestone", token: "limestone", hex: "#E8E2D0", role: "Text. Warm bone, easy on projectors." },
  { name: "Verdigris", token: "verdigris", hex: "#3FBFA6", role: "Oxidized copper: the network and primary actions." },
  { name: "Saffron", token: "saffron", hex: "#F2B33D", role: "Rising relative score; attention." },
  { name: "Vermilion", token: "vermilion", hex: "#FF5A36", role: "Leading candidate; leak heat." },
  { name: "Tracer violet", token: "tracer", hex: "#B48CFF", role: "UV tracer dye. Reserved for the revealed truth." },
  { name: "Phosphor", token: "phosphor", hex: "#D4F26A", role: "Pressure-logger LED. Sensors only." },
];

type Check = { label: string; state: "idle" | "run" | "pass" | "fail"; detail?: string };

const INITIAL: Check[] = [
  { label: "GET /health", state: "idle" },
  { label: "GET /network", state: "idle" },
  { label: "POST /scenario/leak (seed 1042)", state: "idle" },
  { label: "Truth absent from leak response", state: "idle" },
  { label: "POST /detect", state: "idle" },
  { label: "Unknown scenario → 404 with hint", state: "idle" },
];

export function FoundationPage() {
  const [checks, setChecks] = useState<Check[]>(INITIAL);
  const [running, setRunning] = useState(false);

  async function runSmoke() {
    setRunning(true);
    const next = INITIAL.map((c) => ({ ...c }));
    const set = (i: number, state: Check["state"], detail?: string) => {
      next[i] = { ...next[i], state, detail };
      setChecks([...next]);
    };
    const step = async (i: number, fn: () => Promise<string>) => {
      set(i, "run");
      const t0 = performance.now();
      try {
        const d = await fn();
        set(i, "pass", `${d} · ${Math.round(performance.now() - t0)} ms`);
        return true;
      } catch (e) {
        set(i, "fail", e instanceof ApiError ? `${e.message} ${e.hint}` : String(e));
        return false;
      }
    };
    let scenarioId = "";
    let leakJson = "";
    const ok =
      (await step(0, async () => {
        const h = await api.health();
        return h.signatures_ready ? "signatures ready" : `building ${Math.round((h.progress ?? 0) * 100)}%`;
      })) &&
      (await step(1, async () => {
        const n = await api.network();
        return `${n.nodes.length} nodes · ${n.pipes.length} links · ${n.default_sensors.length} sensors`;
      })) &&
      (await step(2, async () => {
        const s = await api.leak({ seed: 1042, noise: "mid" });
        scenarioId = s.scenario_id;
        leakJson = JSON.stringify(s);
        const offline = Object.values(s.readings).filter((v) => v === null).length;
        return `${s.scenario_id} · ${s.sensors.length} readings${offline ? ` · ${offline} offline` : ""}`;
      })) &&
      (await step(3, async () => {
        if (/true_leak|true_size/.test(leakJson)) throw new Error("truth field present in /scenario/leak");
        return "no truth fields";
      })) &&
      (await step(4, async () => {
        const d = await api.detect(scenarioId);
        return `${d.status} · top ${d.candidates[0]?.node ?? "-"} (relative score ${d.candidates[0]?.score.toFixed(3) ?? "-"})`;
      })) &&
      (await step(5, async () => {
        try {
          await api.detect("expired-id");
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) return `“${e.hint}”`;
          throw e;
        }
        throw new Error("expected a 404");
      }));
    setRunning(false);
    if (ok) toast.success("Contract smoke test passed", { description: USE_MOCKS ? "Against the in-browser mock engine." : `Against ${API_URL}.` });
    else toast.error("Contract smoke test failed", { description: "See the failing check for the hint." });
  }

  return (
    <div className="relative min-h-full overflow-x-hidden">
      <div className="aquifer-bg" />
      <div className="aquifer-grain" />
      <main className="relative z-10 mx-auto max-w-6xl px-6 py-10">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <AquaTraceMark className="size-11" />
            <div>
              <h1 className="font-display text-3xl font-bold tracking-tight">
                Aqua<span className="text-verdigris">Trace</span>
              </h1>
              <Eyebrow>Foundation · design system & contract</Eyebrow>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {USE_MOCKS ? <Badge tone="saffron" dot>MOCK ENGINE</Badge> : <Badge tone="verdigris" dot>LIVE API · {API_URL}</Badge>}
            <Badge tone="neutral">contract v1.0</Badge>
          </div>
        </header>

        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.2, 0.7, 0.2, 1] }}
          className="mt-10 grid gap-6 lg:grid-cols-[1.2fr_1fr]"
        >
          <Panel className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Eyebrow>Contract smoke test</Eyebrow>
                <h2 className="mt-1 font-display text-xl font-semibold">Same client, mock or live</h2>
                <p className="mt-1 max-w-md text-[0.9rem] text-silt">
                  Runs through <code className="num text-limestone-dim">api/client.ts</code>, the exact path the console will use. Flip{" "}
                  <code className="num text-limestone-dim">VITE_USE_MOCKS=false</code> to hit the backend.
                </p>
              </div>
              <Button tone="primary" size="lg" loading={running} icon={<Play className="size-4" />} onClick={runSmoke}>
                Run
              </Button>
            </div>
            <ul className="mt-5 space-y-2">
              {checks.map((c, i) => (
                <motion.li
                  key={c.label}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="flex items-start gap-3 rounded-xl bg-ink-950/50 px-3 py-2.5 ring-1 ring-ink-700"
                >
                  <CheckIcon state={c.state} />
                  <div className="min-w-0 flex-1">
                    <div className="num text-[0.85rem] text-limestone">{c.label}</div>
                    {c.detail && <div className={`mt-0.5 text-[0.8rem] ${c.state === "fail" ? "text-vermilion" : "text-silt"}`}>{c.detail}</div>}
                  </div>
                </motion.li>
              ))}
            </ul>
          </Panel>

          <Panel className="p-6">
            <Eyebrow>Honesty rules, built in</Eyebrow>
            <ul className="mt-3 space-y-3 text-[0.92rem]">
              <Rule icon={<ShieldCheck className="size-4 text-tracer" />}>
                Truth appears <b className="text-tracer">only</b> after Reveal, drawn in tracer violet and used nowhere else.
              </Rule>
              <Rule icon={<FlaskConical className="size-4 text-verdigris" />}>
                Every number carries a provenance tag: <Prov kind="simulated" /> <Prov kind="measured" /> <Prov kind="assumed" />
              </Rule>
              <Rule icon={<RippleDot className="mt-1 size-2.5" />}>
                Scores are <Prov kind="relative score" />, never "probability" or "confidence".
              </Rule>
            </ul>
            <div className="mt-6">
              <Eyebrow>Relative score ramp</Eyebrow>
              <div className="score-ramp mt-2 h-3 rounded-full" />
              <div className="mt-1.5 flex justify-between text-[0.8rem] text-silt">
                <span>weak evidence</span>
                <span>leading candidate</span>
              </div>
              <div className="mt-3 flex gap-1.5">
                {Array.from({ length: 11 }, (_, i) => (
                  <div key={i} className="h-6 flex-1 rounded-md" style={{ background: rampColor(i / 10) }} />
                ))}
              </div>
            </div>
          </Panel>
        </motion.section>

        <section className="mt-10">
          <Eyebrow>Palette · Verdigris & Saffron</Eyebrow>
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            {SWATCHES.map((s, i) => (
              <motion.div
                key={s.token}
                initial={{ opacity: 0, y: 14, rotateX: -12 }}
                animate={{ opacity: 1, y: 0, rotateX: 0 }}
                transition={{ delay: 0.15 + i * 0.05, duration: 0.5 }}
                whileHover={{ y: -4, rotateX: 4, rotateY: -4 }}
                style={{ transformPerspective: 700 }}
                className="overflow-hidden rounded-2xl border border-ink-600/70 bg-ink-900"
              >
                <div className="h-20" style={{ background: s.hex }} />
                <div className="p-3">
                  <div className="flex items-baseline justify-between">
                    <span className="font-display font-semibold">{s.name}</span>
                    <span className="num text-[0.8rem] text-silt">{s.hex}</span>
                  </div>
                  <p className="mt-1 text-[0.8rem] leading-snug text-silt">{s.role}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        <section className="mt-10 grid gap-6 lg:grid-cols-2">
          <Panel className="p-6">
            <Eyebrow>Type</Eyebrow>
            <div className="mt-3 space-y-2">
              <div className="font-display text-4xl font-bold tracking-tight">Find the leak, not the guess.</div>
              <div className="text-lg text-limestone-dim">Instrument Sans for reading at projector distance.</div>
              <div className="num text-lg text-verdigris-bright">node 211 · 0.412 · 6.80 L/s</div>
            </div>
          </Panel>
          <Panel className="p-6">
            <Eyebrow>Controls</Eyebrow>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button tone="primary">Simulate hidden leak</Button>
              <Button tone="ghost">Detect</Button>
              <Button tone="tracer">Reveal truth</Button>
              <Button tone="danger" size="md">Leak found here</Button>
              <Button tone="ghost" loading>
                Detecting
              </Button>
              <Button tone="primary" disabled>
                Disabled
              </Button>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Badge tone="verdigris" dot>investigating</Badge>
              <Badge tone="tracer">truth revealed</Badge>
              <Badge tone="phosphor">sensor</Badge>
              <Badge tone="vermilion">insufficient evidence</Badge>
              <Badge tone="saffron">scripted mode</Badge>
              <span className="text-[0.8rem] text-silt">
                Reset view <Kbd>R</Kbd>
              </span>
            </div>
          </Panel>
        </section>
      </main>
    </div>
  );
}

function CheckIcon({ state }: { state: Check["state"] }) {
  if (state === "pass") return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-verdigris" />;
  if (state === "fail") return <XCircle className="mt-0.5 size-4 shrink-0 text-vermilion" />;
  if (state === "run") return <CircleDashed className="mt-0.5 size-4 shrink-0 animate-spin text-saffron" />;
  return <CircleDashed className="mt-0.5 size-4 shrink-0 text-silt-dim" />;
}

function Rule({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-0.5">{icon}</span>
      <span className="text-limestone-dim">{children}</span>
    </li>
  );
}
