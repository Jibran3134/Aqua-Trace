import { palette } from "../../ui/tokens";
import { BarChart3, Check, RotateCcw, Table2 } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { USE_MOCKS } from "../../api/client";
import type { CurvePoint } from "../../contracts/types";
import { useStore } from "../../state/store";
import { Badge, Button, Eyebrow, Prov, cn } from "../../ui/primitives";

// Same validated method/baseline pair as the Evaluation tab (see EvaluationTab.tsx).

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function SensorsTab() {
  const placement = useStore((s) => s.placement);
  const k = useStore((s) => s.placementK);
  const busy = useStore((s) => s.busy);
  const noise = useStore((s) => s.controls.noise);
  const custom = useStore((s) => s.customSensors);
  const load = useStore((s) => s.loadPlacement);
  const apply = useStore((s) => s.applySensors);
  const frame = useStore((s) => s.frame);
  const [view, setView] = useState<"chart" | "table">("chart");

  useEffect(() => {
    if (!placement) void load(k);
  }, [placement, load, k]);

  useEffect(() => {
    if (placement?.sensors.length) frame(placement.sensors);
  }, [placement, frame]);

  const point = placement?.curve.find((p) => p.k === k);
  const applied = !!custom && !!placement && custom.join() === placement.sensors.join();

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <Eyebrow>Stretch S1 · sensor placement</Eyebrow>
          <h2 className="mt-0.5 font-display text-xl font-bold">Where should the next logger go?</h2>
        </div>
        {USE_MOCKS ? <Badge tone="saffron">MOCK numbers</Badge> : <Prov kind="simulated" />}
      </div>
      <p className="text-[0.86rem] text-limestone-dim">
        Greedy placement adds, one at a time, the junction that lets the most pairs of leak locations be told apart at <b>{noise}</b> noise.
      </p>

      <div className="rounded-xl bg-ink-950/50 p-3 ring-1 ring-ink-700">
        <div className="flex items-center justify-between">
          <label htmlFor="k-slider" className="text-[0.82rem] text-silt">
            Sensors
          </label>
          <span className="num text-xl font-bold text-phosphor">{k}</span>
        </div>
        <input
          id="k-slider"
          type="range"
          min={1}
          max={12}
          value={k}
          disabled={busy !== null && busy !== "place"}
          onChange={(e) => void load(Number(e.target.value))}
          className="mt-2 w-full accent-[var(--color-phosphor)]"
        />
        {point && (
          <div className="mt-2 grid grid-cols-2 gap-2 text-[0.8rem]">
            <Compare label="Greedy top-3" value={pct(point.top3)} color={palette().chartMethod} />
            <Compare label="Farthest-point top-3" value={point.baseline_top3 !== undefined ? pct(point.baseline_top3) : "–"} color={palette().chartBaseline} hatched />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 text-[0.8rem] text-limestone-dim">
          <span className="inline-flex items-center gap-1.5">
            <svg width="18" height="8" aria-hidden>
              <line x1="0" y1="4" x2="18" y2="4" stroke={palette().chartMethod} strokeWidth="2" />
              <circle cx="9" cy="4" r="3" fill={palette().chartMethod} />
            </svg>
            Greedy
          </span>
          <span className="inline-flex items-center gap-1.5">
            <svg width="18" height="8" aria-hidden>
              <line x1="0" y1="4" x2="18" y2="4" stroke={palette().chartBaseline} strokeWidth="2" strokeDasharray="4 3" />
              <rect x="6" y="1" width="6" height="6" fill={palette().chartBaseline} />
            </svg>
            Farthest-point
          </span>
        </div>
        <div className="flex rounded-lg bg-ink-800 p-0.5 ring-1 ring-ink-600">
          {(["chart", "table"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-label={`${v} view`}
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={cn("grid size-7 place-items-center rounded-md transition", view === v ? "bg-ink-600 text-limestone" : "text-silt hover:text-limestone")}
            >
              {v === "chart" ? <BarChart3 className="size-3.5" /> : <Table2 className="size-3.5" />}
            </button>
          ))}
        </div>
      </div>

      {!placement ? (
        <div className="skeleton h-[210px] rounded-xl" />
      ) : view === "chart" ? (
        <CurveChart curve={placement.curve} k={k} onPick={(kk) => void load(kk)} />
      ) : (
        <CurveTable curve={placement.curve} k={k} />
      )}

      {placement && (
        <div>
          <div className="mb-1.5 text-[0.8rem] font-semibold uppercase tracking-wider text-silt">Proposed sensors · shown on the map</div>
          <div className="flex flex-wrap gap-1.5">
            {placement.sensors.map((id, i) => (
              <motion.span
                key={id}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.03 }}
                className="num rounded-lg bg-phosphor/10 px-2 py-0.5 text-[0.8rem] text-phosphor ring-1 ring-phosphor/35"
              >
                {id}
              </motion.span>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <Button tone="primary" className="flex-1" disabled={applied || busy !== null} icon={<Check className="size-4" />} onClick={() => apply(placement.sensors)}>
              {applied ? "In use for next leak" : `Use these ${placement.sensors.length} sensors`}
            </Button>
            {custom && (
              <Button tone="ghost" icon={<RotateCcw className="size-4" />} disabled={busy !== null} onClick={() => apply(null)}>
                Default
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Compare({ label, value, color, hatched }: { label: string; value: string; color: string; hatched?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="h-3 w-1.5 rounded-sm"
        style={hatched ? { background: `repeating-linear-gradient(45deg, ${color} 0 2px, transparent 2px 4px)` } : { background: color }}
      />
      <span className="text-silt">{label}</span>
      <span className="num ml-auto font-semibold text-limestone">{value}</span>
    </div>
  );
}

/** Accuracy vs k: two series on one 0-100% axis, crosshair tooltip, click to pick k. */
function CurveChart({ curve, k, onPick }: { curve: CurvePoint[]; k: number; onPick: (k: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 400;
  const H = 210;
  const pad = { l: 34, r: 40, t: 12, b: 26 };
  const maxK = curve.length;
  const x = (kk: number) => pad.l + ((kk - 1) / Math.max(1, maxK - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v) * (H - pad.t - pad.b);
  const line = (get: (p: CurvePoint) => number | undefined) =>
    curve
      .filter((p) => get(p) !== undefined)
      .map((p, i) => `${i ? "L" : "M"}${x(p.k).toFixed(1)},${y(get(p)!).toFixed(1)}`)
      .join(" ");
  const last = curve[curve.length - 1];
  const hp = hover !== null ? curve.find((p) => p.k === hover) : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="Top-3 hit rate versus number of sensors, greedy vs farthest-point placement"
        onMouseLeave={() => setHover(null)}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke={palette().grid} strokeWidth="1" />
            <text x={pad.l - 6} y={y(v) + 3.5} textAnchor="end" className="font-mono text-[9px]" fill={palette().muted}>
              {v * 100}%
            </text>
          </g>
        ))}
        {curve.map((p) => (
          <text key={p.k} x={x(p.k)} y={H - 8} textAnchor="middle" className="font-mono text-[9px]" fill={palette().muted}>
            {p.k}
          </text>
        ))}
        <line x1={x(k)} x2={x(k)} y1={pad.t} y2={H - pad.b} stroke={palette().sensor} strokeOpacity="0.6" strokeDasharray="3 3" />

        <motion.path d={line((p) => p.baseline_top3)} fill="none" stroke={palette().chartBaseline} strokeWidth="2" strokeDasharray="5 4" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9 }} />
        <motion.path d={line((p) => p.top3)} fill="none" stroke={palette().chartMethod} strokeWidth="2" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9 }} />

        {curve.map((p) => (
          <g key={p.k}>
            {p.baseline_top3 !== undefined && (
              <rect x={x(p.k) - 3.5} y={y(p.baseline_top3) - 3.5} width="7" height="7" fill={palette().chartBaseline} stroke={palette().panel} strokeWidth="2" />
            )}
            <circle cx={x(p.k)} cy={y(p.top3)} r={p.k === k ? 5.5 : 4} fill={palette().chartMethod} stroke={palette().panel} strokeWidth="2" />
          </g>
        ))}

        {/* Direct labels at the line ends (text tokens, not series colors). */}
        <text x={x(last.k) + 8} y={y(last.top3) + 3} className="text-[9.5px] font-semibold" fill={palette().text}>
          {pct(last.top3)}
        </text>
        {last.baseline_top3 !== undefined && (
          <text x={x(last.k) + 8} y={y(last.baseline_top3) + 3} className="text-[9.5px]" fill={palette().textDim}>
            {pct(last.baseline_top3)}
          </text>
        )}

        {hp && <line x1={x(hp.k)} x2={x(hp.k)} y1={pad.t} y2={H - pad.b} stroke={palette().text} strokeOpacity="0.35" />}
        {/* Hit targets wider than the marks: one column per k. */}
        {curve.map((p) => (
          <rect
            key={p.k}
            x={x(p.k) - (W - pad.l - pad.r) / (2 * (maxK - 1))}
            y={pad.t}
            width={(W - pad.l - pad.r) / (maxK - 1)}
            height={H - pad.t - pad.b}
            fill="transparent"
            className="cursor-pointer"
            onMouseEnter={() => setHover(p.k)}
            onClick={() => onPick(p.k)}
          />
        ))}
      </svg>
      {hp && (
        <div
          className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink-800 px-2.5 py-1.5 text-[0.8rem] shadow-lift ring-1 ring-ink-600"
          style={{ left: `${(x(hp.k) / W) * 100}%` }}
        >
          <div className="font-semibold text-limestone">{hp.k} sensors</div>
          <div className="text-limestone-dim">
            Greedy top-3 <span className="num">{pct(hp.top3)}</span> · top-1 <span className="num">{pct(hp.top1)}</span>
          </div>
          {hp.baseline_top3 !== undefined && (
            <div className="text-limestone-dim">
              Farthest-point top-3 <span className="num">{pct(hp.baseline_top3)}</span>
            </div>
          )}
        </div>
      )}
      <div className="mt-0.5 text-center text-[0.8rem] text-silt">number of sensors · top-3 hit rate on 40 validation seeds</div>
    </div>
  );
}

function CurveTable({ curve, k }: { curve: CurvePoint[]; k: number }) {
  return (
    <div className="max-h-56 overflow-auto rounded-xl ring-1 ring-ink-700">
      <table className="w-full text-[0.8rem]">
        <thead className="sticky top-0 bg-ink-800 text-left text-[0.8rem] uppercase tracking-wider text-silt">
          <tr>
            <th className="px-2.5 py-2">k</th>
            <th className="px-2 py-2 text-right">Greedy top-1</th>
            <th className="px-2 py-2 text-right">Greedy top-3</th>
            <th className="px-2.5 py-2 text-right">Farthest top-3</th>
          </tr>
        </thead>
        <tbody className="num">
          {curve.map((p) => (
            <tr key={p.k} className={cn("border-t border-ink-700/70", p.k === k && "bg-phosphor/[0.06]")}>
              <td className="px-2.5 py-1.5">{p.k}</td>
              <td className="px-2 py-1.5 text-right">{pct(p.top1)}</td>
              <td className="px-2 py-1.5 text-right">{pct(p.top3)}</td>
              <td className="px-2.5 py-1.5 text-right text-silt">{p.baseline_top3 !== undefined ? pct(p.baseline_top3) : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
