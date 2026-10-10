import { motion } from "motion/react";
import type { DetectStatus, Evidence } from "../../contracts/types";
import { Eyebrow, Prov } from "../../ui/primitives";

/** Residual norm vs noise floor on one shared scale: the single most honest number on screen. */
export function EvidenceMeter({ evidence, status }: { evidence: Evidence; status: DetectStatus }) {
  const max = Math.max(evidence.residual_norm, evidence.noise_floor) * 1.25 || 1;
  const signal = (evidence.residual_norm / max) * 100;
  const floor = (evidence.noise_floor / max) * 100;
  const ratio = evidence.noise_floor > 0 ? evidence.residual_norm / evidence.noise_floor : 0;
  const ok = status === "ok";

  return (
    <div className="rounded-xl bg-ink-950/40 p-3 ring-1 ring-ink-700">
      <div className="flex items-baseline justify-between">
        <Eyebrow>Evidence</Eyebrow>
        <Prov kind="simulated" />
      </div>
      <div className="relative mt-3 h-3 rounded-full bg-ink-700">
        <motion.div
          className="h-full rounded-full"
          style={{ background: ok ? "linear-gradient(90deg,#1f7f70,#3fbfa6)" : "linear-gradient(90deg,#7a5a1d,#f2b33d)" }}
          initial={{ width: 0 }}
          animate={{ width: `${signal}%` }}
          transition={{ duration: 0.8, ease: [0.2, 0.7, 0.2, 1] }}
        />
        <div className="absolute -top-1.5 h-6 w-0.5 rounded bg-limestone" style={{ left: `${floor}%` }} title="noise floor" />
        <div className="absolute top-5 -translate-x-1/2 whitespace-nowrap text-[0.66rem] text-limestone-dim" style={{ left: `${floor}%` }}>
          noise floor
        </div>
      </div>
      <div className="mt-6 grid grid-cols-3 gap-2 text-[0.78rem]">
        <Stat label="residual" value={evidence.residual_norm.toFixed(2)} unit="m" />
        <Stat label="noise floor" value={evidence.noise_floor.toFixed(2)} unit="m" />
        <Stat label="signal / floor" value={`${ratio.toFixed(1)}×`} accent={ok ? "text-verdigris-bright" : "text-saffron"} />
        <Stat label="top1 / top2" value={`${evidence.margin_top1_vs_top2.toFixed(2)}×`} />
        {evidence.live_sensors !== undefined && <Stat label="live sensors" value={String(evidence.live_sensors)} />}
      </div>
    </div>
  );
}

function Stat({ label, value, unit, accent }: { label: string; value: string; unit?: string; accent?: string }) {
  return (
    <div>
      <div className="text-silt">{label}</div>
      <div className={`num text-[0.95rem] ${accent ?? "text-limestone"}`}>
        {value}
        {unit && <span className="ml-0.5 text-[0.7rem] text-silt">{unit}</span>}
      </div>
    </div>
  );
}
