import { palette } from "../../ui/tokens";
import { RotateCcw, Table2, BarChart3 } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { USE_MOCKS } from "../../api/client";
import type { EvalResponse, Metrics } from "../../contracts/types";
import { useStore } from "../../state/store";
import { Badge, Button, Eyebrow, Prov, cn } from "../../ui/primitives";

// Validated pair (dataviz validator, dark surface #0C1F23): L in band, chroma >= 0.1, normal-vision
// dE 19.2, protan dE 6.6 -> legal only with secondary encoding, so baseline is also hatched and
// every bar is direct-labeled.


const pct = (x: number) => `${Math.round(x * 100)}%`;

export function EvaluationTab() {
  const evaluation = useStore((s) => s.evaluation);
  const error = useStore((s) => s.evaluationError);
  const load = useStore((s) => s.loadEvaluation);
  const [view, setView] = useState<"chart" | "table">("chart");

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <div className="rounded-2xl bg-vermilion/[0.07] p-5 text-center ring-1 ring-vermilion/40">
        <div className="font-display text-lg font-bold">Evaluation not available</div>
        <p className="mt-1 text-[0.86rem] text-limestone-dim">{error.message}</p>
        <p className="text-[0.8rem] text-silt">{error.hint}</p>
        <Button tone="ghost" className="mt-3" icon={<RotateCcw className="size-4" />} onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  }
  if (!evaluation) {
    return (
      <div className="space-y-3">
        <div className="text-[0.86rem] text-silt">Running {USE_MOCKS ? "100 held-out test scenarios" : "evaluation lookup"}…</div>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skeleton h-16 rounded-xl" />
        ))}
      </div>
    );
  }

  const { results: m, baseline: b } = evaluation;
  const lift = b.top3 > 0 ? m.top3 / b.top3 : Infinity;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <Eyebrow>Held-out test seeds · {evaluation.meta.network}</Eyebrow>
          <h2 className="mt-0.5 font-display text-xl font-bold">Does it beat a naive guess?</h2>
        </div>
        {USE_MOCKS ? <Badge tone="saffron">MOCK numbers</Badge> : <Prov kind="simulated" />}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Kpi label="Top-3 hit rate" method={pct(m.top3)} base={pct(b.top3)} />
        <Kpi label="Top-1 hit rate" method={pct(m.top1)} base={pct(b.top1)} />
        <Kpi label="Mean hop error" method={m.mean_hop_error.toFixed(1)} base={b.mean_hop_error.toFixed(1)} lowerIsBetter />
      </div>

      <Verdict lift={lift} />

      <div className="flex items-center justify-between">
        <Legend />
        <div className="flex rounded-lg bg-ink-800 p-0.5 ring-1 ring-ink-600">
          <ViewBtn active={view === "chart"} onClick={() => setView("chart")} label="Chart view">
            <BarChart3 className="size-3.5" />
          </ViewBtn>
          <ViewBtn active={view === "table"} onClick={() => setView("table")} label="Table view">
            <Table2 className="size-3.5" />
          </ViewBtn>
        </div>
      </div>

      {view === "chart" ? (
        <div className="space-y-4">
          <Group title="By sensor noise" rows={(["low", "mid", "high"] as const).map((k) => [k, evaluation.by_noise[k]])} />
          <Group title="By leak size" rows={(["small", "medium", "large"] as const).map((k) => [k, evaluation.by_size[k]])} />
          <Group title="By number of sensors" rows={Object.entries(evaluation.by_k).map(([k, v]) => [`k = ${k}`, v])} />
        </div>
      ) : (
        <MetricsTable evaluation={evaluation} />
      )}

      {evaluation.gate && (
        <div className="grid grid-cols-2 gap-2 text-[0.8rem]">
          <Gate label="No-leak scenarios correctly flagged" value={evaluation.gate.no_leak_flagged} good />
          <Gate label="Small leaks flagged as insufficient" value={evaluation.gate.small_leak_flagged} />
        </div>
      )}

      <p className="text-[0.8rem] leading-snug text-silt">
        {evaluation.meta.seeds} fixed test seeds · {evaluation.meta.k} sensors · time step {evaluation.meta.time_step} · {evaluation.meta.note} Failures included; nothing
        cherry-picked.
      </p>
    </div>
  );
}

function Kpi({ label, method, base, lowerIsBetter }: { label: string; method: string; base: string; lowerIsBetter?: boolean }) {
  return (
    <div className="rounded-xl bg-ink-950/50 p-2.5 ring-1 ring-ink-700">
      <div className="text-[0.8rem] leading-tight text-silt">{label}</div>
      <div className="num mt-1 text-[1.35rem] font-bold leading-none text-limestone">{method}</div>
      <div className="mt-1 text-[0.8rem] text-silt">
        baseline <span className="num text-limestone-dim">{base}</span>
        {lowerIsBetter && <span className="text-silt-dim"> · lower is better</span>}
      </div>
    </div>
  );
}

function Verdict({ lift }: { lift: number }) {
  const strong = lift >= 1.5;
  return (
    <div className={cn("rounded-xl px-3 py-2 text-[0.84rem] ring-1", strong ? "bg-verdigris/[0.08] ring-verdigris/35" : "bg-saffron/[0.08] ring-saffron/35")}>
      {Number.isFinite(lift) ? (
        strong ? (
          <>
            Top-3 hit rate is <b className="num text-verdigris-bright">{lift.toFixed(1)}×</b> the naive baseline (nearest junction to the biggest pressure drop).
          </>
        ) : (
          <>
            Honest read: the method only <b className="text-saffron">barely beats</b> the baseline ({lift.toFixed(2)}×). Its edge shows under noise and with fewer sensors.
          </>
        )
      ) : (
        "Baseline never hits the top 3 on these seeds."
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-4 text-[0.8rem] text-limestone-dim">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-4 rounded-[3px]" style={{ background: palette().chartMethod }} /> AquaTrace
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-4 rounded-[3px]" style={hatch(palette().chartBaseline)} /> Naive baseline
      </span>
      <span className="text-silt">top-3 hit rate</span>
    </div>
  );
}

function hatch(color: string): React.CSSProperties {
  return { background: `repeating-linear-gradient(45deg, ${color} 0 3px, color-mix(in oklab, ${color} 45%, transparent) 3px 6px)` };
}

function Group({ title, rows }: { title: string; rows: [string, Metrics][] }) {
  const [hover, setHover] = useState<string | null>(null);
  return (
    <div>
      <div className="mb-1.5 text-[0.8rem] font-semibold uppercase tracking-wider text-silt">{title}</div>
      <div className="space-y-2.5">
        {rows.map(([label, v], i) => {
          const base = v.baseline_top3 ?? 0;
          return (
            <div key={label} className="grid grid-cols-[4.2rem_1fr] items-center gap-2">
              <div className="text-[0.82rem] capitalize text-limestone-dim">{label}</div>
              <div className="relative space-y-[2px]" onMouseLeave={() => setHover(null)}>
                <Bar value={v.top3} color={palette().chartMethod} delay={i * 0.06} onHover={() => setHover(`${label}-m`)} />
                <Bar value={base} color={palette().chartBaseline} hatched delay={i * 0.06 + 0.03} onHover={() => setHover(`${label}-b`)} />
                {(hover === `${label}-m` || hover === `${label}-b`) && (
                  <div className="pointer-events-none absolute right-0 top-full z-20 mt-1 whitespace-nowrap rounded-lg bg-ink-800 px-2.5 py-1.5 text-[0.8rem] shadow-lift ring-1 ring-ink-600">
                    <div className="font-semibold capitalize text-limestone">{label}</div>
                    <div className="text-limestone-dim">
                      AquaTrace top-3 <span className="num">{pct(v.top3)}</span> · top-1 <span className="num">{pct(v.top1)}</span> · hops <span className="num">{v.mean_hop_error}</span>
                    </div>
                    <div className="text-limestone-dim">
                      Baseline top-3 <span className="num">{pct(base)}</span>
                    </div>
                    {v.insufficient > 0 && <div className="text-silt">flagged insufficient: {pct(v.insufficient)}</div>}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Bar({ value, color, hatched, delay, onHover }: { value: number; color: string; hatched?: boolean; delay: number; onHover: () => void }) {
  return (
    <div className="flex h-[14px] items-center gap-2" onMouseEnter={onHover}>
      <div className="relative h-full flex-1 rounded-r-[4px] bg-ink-800/60">
        <motion.div
          className="h-full rounded-r-[4px]"
          style={hatched ? hatch(color) : { background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(1, value * 100)}%` }}
          transition={{ delay, duration: 0.7, ease: [0.2, 0.7, 0.2, 1] }}
        />
      </div>
      <span className="num w-9 text-right text-[0.8rem] text-limestone-dim">{pct(value)}</span>
    </div>
  );
}

function MetricsTable({ evaluation }: { evaluation: EvalResponse }) {
  const rows: [string, Metrics][] = [
    ["Overall", evaluation.results],
    ["Baseline", evaluation.baseline],
    ...(["low", "mid", "high"] as const).map((k) => [`noise ${k}`, evaluation.by_noise[k]] as [string, Metrics]),
    ...(["small", "medium", "large"] as const).map((k) => [`${k} leak`, evaluation.by_size[k]] as [string, Metrics]),
    ...Object.entries(evaluation.by_k).map(([k, v]) => [`k = ${k}`, v] as [string, Metrics]),
  ];
  return (
    <div className="overflow-hidden rounded-xl ring-1 ring-ink-700">
      <table className="w-full text-[0.8rem]">
        <thead className="bg-ink-800/80 text-left text-[0.8rem] uppercase tracking-wider text-silt">
          <tr>
            <th className="px-2.5 py-2">Slice</th>
            <th className="px-2 py-2 text-right">Top-1</th>
            <th className="px-2 py-2 text-right">Top-3</th>
            <th className="px-2 py-2 text-right">Hops</th>
            <th className="px-2 py-2 text-right">Base top-3</th>
            <th className="px-2.5 py-2 text-right">Insuff.</th>
          </tr>
        </thead>
        <tbody className="num">
          {rows.map(([label, v]) => (
            <tr key={label} className="border-t border-ink-700/70">
              <td className="px-2.5 py-1.5 font-sans capitalize text-limestone-dim">{label}</td>
              <td className="px-2 py-1.5 text-right">{pct(v.top1)}</td>
              <td className="px-2 py-1.5 text-right">{pct(v.top3)}</td>
              <td className="px-2 py-1.5 text-right">{v.mean_hop_error.toFixed(1)}</td>
              <td className="px-2 py-1.5 text-right text-silt">{v.baseline_top3 !== undefined ? pct(v.baseline_top3) : "–"}</td>
              <td className="px-2.5 py-1.5 text-right text-silt">{pct(v.insufficient)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Gate({ label, value, good }: { label: string; value: number; good?: boolean }) {
  return (
    <div className="rounded-xl bg-ink-950/50 px-3 py-2 ring-1 ring-ink-700">
      <div className={cn("num text-lg font-bold", good ? "text-verdigris-bright" : "text-limestone")}>{pct(value)}</div>
      <div className="leading-tight text-silt">{label}</div>
    </div>
  );
}

function ViewBtn({ active, onClick, label, children }: { active: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn("grid size-7 place-items-center rounded-md transition", active ? "bg-ink-600 text-limestone" : "text-silt hover:text-limestone")}
    >
      {children}
    </button>
  );
}
