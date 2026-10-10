import { Calculator, Droplets, Trash2, Wrench } from "lucide-react";
import { motion } from "motion/react";
import { USE_MOCKS } from "../../api/client";
import { SAMPLE_BACKLOG, useStore } from "../../state/store";
import { Badge, Button, Eyebrow, Prov, cn } from "../../ui/primitives";

const rs = (x: number) => `Rs ${Math.round(x).toLocaleString("en-PK")}`;
const litres = (x: number) => (x >= 1e6 ? `${(x / 1e6).toFixed(2)} M L` : `${Math.round(x / 1000).toLocaleString("en-PK")} k L`);
const field = "num h-9 w-full rounded-lg bg-ink-850 px-2.5 text-[0.86rem] text-limestone ring-1 ring-ink-600 outline-none focus:ring-2 focus:ring-verdigris/70";

export function RepairsTab() {
  const backlog = useStore((s) => s.backlog);
  const budget = useStore((s) => s.repairBudget);
  const vpl = useStore((s) => s.valuePerLitre);
  const repair = useStore((s) => s.repair);
  const busy = useStore((s) => s.busy);
  const setBacklog = useStore((s) => s.setBacklog);
  const setInputs = useStore((s) => s.setRepairInputs);
  const optimize = useStore((s) => s.optimizeRepairs);
  const flyTo = useStore((s) => s.flyTo);

  const selected = new Set(repair?.selected.map((r) => r.node));
  const dpBeatsGreedy = repair && repair.litres_per_day_saved > repair.greedy.litres_per_day_saved;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <Eyebrow>Stretch S2 + S3 · repair plan</Eyebrow>
          <h2 className="mt-0.5 font-display text-xl font-bold">Which leaks to fix first?</h2>
        </div>
        {USE_MOCKS && <Badge tone="saffron">MOCK</Badge>}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="flex items-center justify-between text-[0.8rem] text-silt">
            Budget <Prov kind="assumed" />
          </span>
          <input className={cn(field, "mt-1")} type="number" min={0} step={50_000} value={budget} onChange={(e) => setInputs({ budget: Math.max(0, Number(e.target.value) || 0) })} />
        </label>
        <label className="block">
          <span className="flex items-center justify-between text-[0.8rem] text-silt">
            Rs per litre <Prov kind="assumed" />
          </span>
          <input className={cn(field, "mt-1")} type="number" min={0} step={0.01} value={vpl} onChange={(e) => setInputs({ valuePerLitre: Math.max(0, Number(e.target.value) || 0) })} />
        </label>
      </div>
      <p className="-mt-2 text-[0.8rem] text-saffron/90">ASSUMPTION: placeholder values; replace with utility data (production + pumping cost, contractor quotes).</p>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[0.8rem] font-semibold uppercase tracking-wider text-silt">Repair backlog ({backlog.length})</span>
          {backlog.length > 0 && (
            <button type="button" className="flex items-center gap-1 text-[0.8rem] text-silt hover:text-vermilion" onClick={() => setBacklog([])}>
              <Trash2 className="size-3" /> clear
            </button>
          )}
        </div>
        {backlog.length === 0 ? (
          <div className="rounded-xl p-4 text-center ring-1 ring-ink-700">
            <Wrench className="mx-auto size-5 text-silt" />
            <p className="mt-1.5 text-[0.84rem] text-limestone-dim">Leaks confirmed by a crew land here automatically.</p>
            <p className="text-[0.8rem] text-silt">Run a few investigations, or load a labeled sample to try the optimizer.</p>
            <Button tone="ghost" size="sm" className="mt-3" onClick={() => setBacklog(SAMPLE_BACKLOG)}>
              Load sample backlog
            </Button>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {backlog.map((b, i) => {
              const sel = selected.has(b.node);
              return (
                <motion.li
                  key={b.node}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className={cn(
                    "grid grid-cols-[1fr_7.2rem_1.5rem] items-center gap-2 rounded-xl px-3 py-2 ring-1 transition",
                    sel ? "bg-verdigris/10 ring-verdigris/50" : repair ? "bg-ink-950/40 opacity-70 ring-ink-700" : "bg-ink-950/40 ring-ink-700",
                  )}
                >
                  <button type="button" className="min-w-0 text-left" onClick={() => flyTo(b.node)}>
                    <div className="flex items-center gap-1.5">
                      <span className="num font-bold">Node {b.node}</span>
                      {sel && <Badge tone="verdigris">fix</Badge>}
                      {b.source === "sample" ? <Badge tone="neutral">sample</Badge> : <Badge tone="vermilion">crew-confirmed</Badge>}
                    </div>
                    <div className="text-[0.8rem] text-silt">
                      ≈<span className="num">{b.est_leak_lps.toFixed(1)} L/s</span> · {litres(b.est_leak_lps * 86_400)}/day <Prov kind="simulated estimate" />
                    </div>
                  </button>
                  <input
                    aria-label={`Repair cost for node ${b.node} in rupees`}
                    className={cn(field, "h-8 text-right text-[0.8rem]")}
                    type="number"
                    min={0}
                    step={10_000}
                    placeholder="default"
                    value={b.repair_cost_pkr ?? ""}
                    onChange={(e) =>
                      setBacklog(backlog.map((x) => (x.node === b.node ? { ...x, repair_cost_pkr: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) } : x)))
                    }
                  />
                  <button type="button" aria-label={`Remove node ${b.node}`} className="grid place-items-center text-silt hover:text-vermilion" onClick={() => setBacklog(backlog.filter((x) => x.node !== b.node))}>
                    <Trash2 className="size-3.5" />
                  </button>
                </motion.li>
              );
            })}
          </ul>
        )}
      </div>

      <Button tone="primary" size="lg" className="w-full" disabled={!backlog.length || busy !== null} loading={busy === "repair"} icon={<Calculator className="size-5" />} onClick={optimize}>
        Optimize repair plan
      </Button>

      {repair && (
        <motion.div
          ref={(el) => el?.scrollIntoView({ behavior: "smooth", block: "nearest" })}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-3 rounded-2xl bg-ink-950/50 p-3.5 ring-1 ring-verdigris/35"
        >
          <div className="grid grid-cols-3 gap-2">
            <Stat icon={<Droplets className="size-3.5" />} label="water saved / day" value={litres(repair.litres_per_day_saved)} prov="simulated" />
            <Stat label="value / day" value={rs(repair.value_pkr_per_day)} prov="assumed" />
            <Stat label="payback" value={repair.payback_days !== null ? `${repair.payback_days} days` : "–"} prov="assumed" />
          </div>
          <div className="text-[0.8rem] text-limestone-dim">
            Fix <b className="num text-verdigris-bright">{repair.selected.map((s) => s.node).join(", ") || "nothing"}</b> for{" "}
            <span className="num">{rs(repair.total_cost_pkr)}</span> of <span className="num">{rs(budget)}</span>.
            {repair.selected.some((s) => s.cost_defaulted) && <span className="text-saffron"> Some costs use the default ({rs(repair.assumptions.default_repair_cost_pkr)}).</span>}
          </div>
          <div className="rounded-lg bg-ink-850 px-3 py-2 text-[0.8rem] text-silt ring-1 ring-ink-700">
            Greedy (best litres per rupee) would save <span className="num text-limestone-dim">{litres(repair.greedy.litres_per_day_saved)}</span>/day
            {dpBeatsGreedy ? (
              <>
                , so the exact optimizer recovers <b className="num text-verdigris-bright">{litres(repair.litres_per_day_saved - repair.greedy.litres_per_day_saved)}</b>/day more.
              </>
            ) : (
              <>; on this backlog greedy is already optimal.</>
            )}
          </div>
          <div className="num text-[0.8rem] leading-relaxed text-silt">
            litres/day = L/s × 86,400 · value/day = litres/day × Rs {repair.assumptions.value_per_litre_pkr}/L · payback = cost ÷ value/day
            <br />
            <span className="font-sans">Note: {repair.note}. {repair.assumptions.label}.</span>
          </div>
        </motion.div>
      )}
    </div>
  );
}

function Stat({ label, value, prov, icon }: { label: string; value: string; prov: "assumed" | "simulated"; icon?: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-ink-850 px-2.5 py-2 ring-1 ring-ink-700">
      <div className="flex items-center gap-1 text-[0.8rem] leading-tight text-silt">
        {icon}
        {label}
      </div>
      <div className="num mt-0.5 text-[0.98rem] font-bold leading-tight text-limestone">{value}</div>
      <Prov kind={prov} className="!mx-0 !text-[0.8rem]" />
    </div>
  );
}
