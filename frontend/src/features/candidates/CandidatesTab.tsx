import { AlertTriangle, ArrowRight, Clock3, Plus, RotateCcw, Waves } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useStore } from "../../state/store";
import { Badge, Button, Eyebrow, Prov } from "../../ui/primitives";
import { CandidateList } from "./CandidateList";
import { EvidenceMeter } from "./EvidenceMeter";
import { ReadingsTable } from "./ReadingsTable";
import { RevealCard } from "./RevealCard";

const fade = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -6 }, transition: { duration: 0.28 } };

export function CandidatesTab() {
  const busy = useStore((s) => s.busy);
  const scenario = useStore((s) => s.scenario);
  const detection = useStore((s) => s.detection);
  const reveal = useStore((s) => s.reveal);
  const expired = useStore((s) => s.expired);

  let body: React.ReactNode;
  let key: string;
  if (expired) {
    key = "expired";
    body = <Expired />;
  } else if (busy === "simulate") {
    key = "sim";
    body = <Working title="Running hydraulic snapshot" detail="Hidden leak injected · demand drift ±10% · sensor noise applied." />;
  } else if (!scenario) {
    key = "empty";
    body = <Empty />;
  } else if (busy === "detect" && !detection) {
    key = "detect";
    body = <Working title="Matching leak signatures" detail="Comparing the sensor residual against every candidate junction." />;
  } else if (!detection) {
    key = "readings";
    body = <AwaitingDetect />;
  } else {
    key = `det-${scenario.scenario_id}`;
    body = (
      <div className="space-y-4">
        {reveal && <RevealCard />}
        {detection.status === "insufficient_evidence" ? <Insufficient /> : <CandidateList />}
        <EvidenceMeter evidence={detection.evidence} status={detection.status} />
        <details className="group rounded-xl ring-1 ring-ink-700">
          <summary className="cursor-pointer list-none px-3 py-2 text-[0.82rem] text-silt hover:text-limestone">
            Sensor readings <span className="text-silt-dim">({scenario.sensors.length})</span>
          </summary>
          <div className="px-3 pb-3">
            <ReadingsTable />
          </div>
        </details>
      </div>
    );
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div key={key} {...fade}>
        {body}
      </motion.div>
    </AnimatePresence>
  );
}

function Empty() {
  const simulate = useStore((s) => s.simulate);
  const busy = useStore((s) => s.busy);
  const network = useStore((s) => s.network);
  const steps = [
    ["Simulate", "A leak is hidden somewhere in the network. Nobody, including the UI, knows where."],
    ["Detect", "Sensor residuals are matched to leak signatures and candidates are ranked by relative score."],
    ["Reveal", "Only then is the truth fetched, so you can judge the ranking honestly."],
  ];
  return (
    <div className="flex h-full flex-col">
      <Eyebrow>No scenario yet</Eyebrow>
      <h2 className="mt-1 font-display text-2xl font-bold leading-tight tracking-tight">Where is the water going?</h2>
      <p className="mt-2 text-[0.92rem] text-limestone-dim">
        {network ? `${network.nodes.filter((n) => n.type === "junction").length} junctions, ${network.default_sensors.length} pressure sensors.` : "Loading network…"} Find a hidden leak
        from a handful of readings.
      </p>
      <ol className="mt-5 space-y-3">
        {steps.map(([t, d], i) => (
          <motion.li key={t} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + i * 0.08 }} className="flex gap-3">
            <span className="num grid size-7 shrink-0 place-items-center rounded-full bg-ink-700 text-[0.8rem] font-bold text-verdigris-bright ring-1 ring-ink-500">{i + 1}</span>
            <div>
              <div className="font-semibold">{t}</div>
              <div className="text-[0.84rem] text-silt">{d}</div>
            </div>
          </motion.li>
        ))}
      </ol>
      <Button tone="primary" size="lg" className="mt-6 w-full" disabled={!network || busy !== null} icon={<Waves className="size-5" />} onClick={() => simulate()}>
        Simulate hidden leak
      </Button>
    </div>
  );
}

function Working({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="relative grid size-9 place-items-center">
          <span className="absolute inset-0 animate-ripple rounded-full bg-verdigris/40" />
          <span className="size-3 rounded-full bg-verdigris" />
        </span>
        <div>
          <div className="font-semibold">{title}…</div>
          <div className="text-[0.82rem] text-silt">{detail}</div>
        </div>
      </div>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="skeleton h-12 rounded-xl" style={{ animationDelay: `${i * 0.1}s` }} />
      ))}
    </div>
  );
}

function AwaitingDetect() {
  const scenario = useStore((s) => s.scenario);
  const detect = useStore((s) => s.detect);
  const busy = useStore((s) => s.busy);
  if (!scenario) return null;
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Eyebrow>Scenario {scenario.scenario_id}</Eyebrow>
          <h2 className="mt-1 font-display text-xl font-bold">A leak is hidden somewhere</h2>
          <p className="mt-1 text-[0.86rem] text-silt">
            Seed <span className="num text-limestone-dim">{scenario.seed ?? "?"}</span> · noise σ{" "}
            <span className="num text-limestone-dim">{scenario.meta.noise_sigma} m</span> · time step <span className="num text-limestone-dim">{scenario.meta.time_step}</span>
          </p>
        </div>
        <Badge tone="tracer">truth hidden</Badge>
      </div>
      <ReadingsTable />
      <Button tone="primary" size="lg" className="w-full" loading={busy === "detect"} icon={<ArrowRight className="size-5" />} onClick={detect}>
        Detect leak candidates
      </Button>
    </div>
  );
}

function Insufficient() {
  const detection = useStore((s) => s.detection);
  const scenario = useStore((s) => s.scenario);
  const simulate = useStore((s) => s.simulate);
  const busy = useStore((s) => s.busy);
  if (!detection || !scenario) return null;
  const rec = detection.recommended_sensor;
  return (
    <div className="rounded-2xl bg-saffron/[0.07] p-4 ring-1 ring-saffron/40">
      <div className="flex items-center gap-2 text-saffron">
        <AlertTriangle className="size-5" />
        <span className="font-display text-lg font-bold">Insufficient evidence</span>
      </div>
      <p className="mt-1.5 text-[0.9rem] text-limestone-dim">{detection.note ?? "The leak signal does not stand out from noise."}</p>
      <p className="mt-2 text-[0.84rem] text-silt">
        AquaTrace refuses to guess here. Dispatching a crew on noise wastes a day. This is the honest answer, not a failure.
      </p>
      {rec && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-ink-950/50 px-3 py-2.5 ring-1 ring-phosphor/30">
          <div className="text-[0.86rem]">
            Add a sensor at <span className="num font-bold text-phosphor">{rec}</span>
            <div className="text-[0.74rem] text-silt">best separates the two leading candidates</div>
          </div>
          <Button
            tone="ghost"
            size="sm"
            disabled={busy !== null}
            icon={<Plus className="size-3.5" />}
            onClick={() => simulate({ seed: scenario.seed, sensors: [...scenario.sensors, rec] })}
          >
            Add & re-run
          </Button>
        </div>
      )}
      {detection.candidates.length > 0 && (
        <div className="mt-3 text-[0.78rem] text-silt">
          Weak leaders (not actionable): {detection.candidates.slice(0, 3).map((c) => c.node).join(", ")} <Prov kind="relative score" />
        </div>
      )}
    </div>
  );
}

function Expired() {
  const simulate = useStore((s) => s.simulate);
  return (
    <div className="rounded-2xl bg-vermilion/[0.07] p-5 text-center ring-1 ring-vermilion/40">
      <Clock3 className="mx-auto size-7 text-vermilion" />
      <div className="mt-2 font-display text-lg font-bold">Scenario expired</div>
      <p className="mt-1 text-[0.88rem] text-silt">The server restarted and forgot this scenario. Nothing is lost; simulate a fresh one.</p>
      <Button tone="primary" className="mt-4" icon={<RotateCcw className="size-4" />} onClick={() => simulate()}>
        Simulate again
      </Button>
    </div>
  );
}
