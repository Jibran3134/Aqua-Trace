import { Printer, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { USE_MOCKS } from "../../api/client";
import type { AgentEvent } from "../../contracts/types";
import { useStore } from "../../state/store";
import { AquaTraceMark } from "../../ui/primitives";

/**
 * S5: a one-page incident report assembled ONLY from API responses and tool outputs already on
 * screen. No free text is generated, so no number can appear that a tool did not return.
 */
export function InvestigationReport() {
  const open = useStore((s) => s.reportOpen);
  const setReport = useStore((s) => s.setReport);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setReport(false);
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open, setReport]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="report-portal fixed inset-0 z-50 overflow-y-auto bg-ink-950/80 p-4 backdrop-blur-sm sm:p-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setReport(false)}
        >
          <div className="report-actions mx-auto mb-3 flex max-w-[820px] justify-end gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                window.print();
              }}
              className="flex items-center gap-1.5 rounded-xl bg-verdigris px-3.5 py-2 text-[0.88rem] font-semibold text-ink-950 hover:bg-verdigris-bright"
            >
              <Printer className="size-4" /> Print / save PDF
            </button>
            <button type="button" aria-label="Close report" onClick={() => setReport(false)} className="grid size-9 place-items-center rounded-xl bg-ink-800 text-limestone ring-1 ring-ink-600">
              <X className="size-4" />
            </button>
          </div>
          <motion.article
            role="dialog"
            aria-modal="true"
            aria-label="Investigation report"
            initial={{ y: 24, rotateX: 8, opacity: 0 }}
            animate={{ y: 0, rotateX: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 140, damping: 20 }}
            style={{ transformPerspective: 1200 }}
            onClick={(e) => e.stopPropagation()}
            className="report-sheet mx-auto max-w-[820px] rounded-sm bg-[#f6f2e8] p-8 text-[#14201f] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] sm:p-10"
          >
            <ReportBody />
          </motion.article>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function lastResult<T>(events: AgentEvent[], name: string): T | null {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].type === "tool_result" && events[i].name === name) return events[i].result as T;
  return null;
}

function ReportBody() {
  const scenario = useStore((s) => s.scenario);
  const initial = useStore((s) => s.initialDetection);
  const detection = useStore((s) => s.detection);
  const agent = useStore((s) => s.agent);
  const reveal = useStore((s) => s.reveal);
  if (!scenario || !initial) return <p>No investigation to report yet.</p>;

  const plan = lastResult<{ order: string[]; total_length_m: number; depot: string }>(agent.events, "plan_inspection");
  const hyp = lastResult<{ node: string; rmse: number; fit_label: string }>(agent.events, "simulate_hypothesis");
  const visits = [...agent.cleared.map((n) => ({ node: n, found: false })), ...(agent.foundAt ? [{ node: agent.foundAt, found: true }] : [])];
  const outcome =
    agent.state === "resolved" && agent.foundAt
      ? `Leak confirmed by the field crew at node ${agent.foundAt} after ${visits.length} inspection${visits.length === 1 ? "" : "s"}.`
      : agent.state === "abstained"
        ? `No crew dispatched: evidence insufficient.${agent.recommended ? ` Recommended sensor at node ${agent.recommended}.` : ""}`
        : initial.status === "insufficient_evidence"
          ? "No crew dispatched: evidence insufficient."
          : `Investigation open: ${visits.length} inspection${visits.length === 1 ? "" : "s"} so far.`;
  const ev = initial.evidence;
  const now = new Date();

  return (
    <div className="font-sans text-[13px] leading-relaxed">
      <header className="flex items-start justify-between border-b-2 border-[#14201f] pb-3">
        <div className="flex items-center gap-2.5">
          <AquaTraceMark className="size-9" />
          <div>
            <div className="font-display text-xl font-bold tracking-tight">Leak investigation report</div>
            <div className="text-[11px] uppercase tracking-[0.14em] text-[#4b5d5a]">AquaTrace · decision support · Net3</div>
          </div>
        </div>
        <dl className="text-right font-mono text-[11px] text-[#4b5d5a]">
          <div>scenario {scenario.scenario_id}</div>
          <div>seed {scenario.seed ?? "n/a"} · time step {scenario.meta.time_step}</div>
          <div>{now.toLocaleString()}</div>
        </dl>
      </header>

      {USE_MOCKS && (
        <p className="mt-3 rounded border border-[#b07a1a] bg-[#f2b33d]/15 px-3 py-1.5 text-[11.5px] text-[#6b4a10]">
          Generated against the in-browser MOCK engine. Numbers illustrate the workflow only; do not quote them.
        </p>
      )}

      <Section title="Outcome">
        <p className="text-[15px] font-semibold">{outcome}</p>
        <p className="text-[#4b5d5a]">
          Agent mode: {agent.source === "llm" ? "LLM agent (narrative only; all values from tools)" : "scripted investigator"}. Sensors: {scenario.sensors.length} (noise σ {scenario.meta.noise_sigma} m).
        </p>
      </Section>

      <div className="grid grid-cols-2 gap-6">
        <Section title="Evidence at detection" tag="simulated">
          <Table
            rows={[
              ["Status", initial.status.replace("_", " ")],
              ["Residual norm", `${ev.residual_norm.toFixed(3)} m`],
              ["Noise floor", `${ev.noise_floor.toFixed(3)} m`],
              ["Signal / floor", ev.noise_floor > 0 ? `${(ev.residual_norm / ev.noise_floor).toFixed(2)}×` : "n/a"],
              ["Top1 / top2 margin", `${ev.margin_top1_vs_top2.toFixed(2)}×`],
              ["Live sensors", String(ev.live_sensors ?? scenario.sensors.length)],
            ]}
          />
          {hyp && (
            <p className="mt-2 text-[12px] text-[#4b5d5a]">
              Hypothesis check at node {hyp.node}: fit {hyp.fit_label}, rmse {hyp.rmse} m.
            </p>
          )}
        </Section>
        <Section title="Initial ranking" tag="relative score">
          <Table head={["#", "Node", "Score", "Est. L/s"]} rows={initial.candidates.slice(0, 5).map((c, i) => [String(i + 1), c.node, c.score.toFixed(3), c.est_leak_lps.toFixed(1)])} />
          {detection && detection !== initial && (
            <p className="mt-2 text-[12px] text-[#4b5d5a]">After field feedback the leader is node {detection.candidates[0]?.node ?? "n/a"}.</p>
          )}
        </Section>
      </div>

      <Section title="Field inspections">
        {visits.length ? (
          <Table head={["Visit", "Node", "Crew report"]} rows={visits.map((v, i) => [String(i + 1), v.node, v.found ? "LEAK FOUND" : "nothing found (down-weighted, not excluded)"])} />
        ) : (
          <p className="text-[#4b5d5a]">No crew visits recorded.</p>
        )}
        {plan && (
          <p className="mt-2 text-[12px] text-[#4b5d5a]">
            Planned route from depot {plan.depot}: {plan.order.join(" → ")} · {plan.total_length_m.toLocaleString()} m (simulated).
          </p>
        )}
      </Section>

      <Section title="Sensor readings" tag="simulated reading">
        <div className="grid grid-cols-3 gap-x-6 font-mono text-[12px]">
          {scenario.sensors.map((id) => (
            <div key={id} className="flex justify-between border-b border-[#d8d1bf] py-0.5">
              <span>{id}</span>
              <span>{scenario.readings[id] === null ? "offline" : `${scenario.readings[id]!.toFixed(2)} m`}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Ground truth check">
        {reveal ? (
          <p>
            Simulated true leak: node <b>{reveal.true_leak_node}</b> ({reveal.true_size}). Rank of truth {reveal.rank_of_truth > 0 ? `#${reveal.rank_of_truth}` : "outside list"}
            {visits.length > 0 && " after field feedback"}
            {(() => {
              const first = initial.candidates.findIndex((c) => c.node === reveal.true_leak_node) + 1;
              return visits.length > 0 ? ` (initially ${first > 0 ? `#${first}` : "outside the top 10"})` : "";
            })()}
            , top-1 hop error {reveal.hop_error_top1}.
          </p>
        ) : (
          <p className="text-[#4b5d5a]">Truth not revealed. This report reflects field outcomes only.</p>
        )}
      </Section>

      <footer className="mt-6 border-t border-[#d8d1bf] pt-2 text-[10.5px] text-[#4b5d5a]">
        Every value above comes from an API response or tool output; nothing is generated. Scores are relative scores, not probabilities. Limitations: benchmark
        network stand-in (Net3), synthetic demand, junction-level localization, single leak, steady-state snapshot.
      </footer>
    </div>
  );
}

function Section({ title, tag, children }: { title: string; tag?: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 break-inside-avoid">
      <h2 className="mb-1.5 flex items-baseline justify-between text-[11px] font-bold uppercase tracking-[0.16em] text-[#1f7f70]">
        {title}
        {tag && <span className="font-mono text-[9.5px] font-normal text-[#4b5d5a]">{tag}</span>}
      </h2>
      {children}
    </section>
  );
}

function Table({ head, rows }: { head?: string[]; rows: string[][] }) {
  return (
    <table className="w-full border-collapse text-[12.5px]">
      {head && (
        <thead>
          <tr className="border-b border-[#14201f] text-left">
            {head.map((h) => (
              <th key={h} className="py-1 pr-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-[#d8d1bf]">
            {r.map((c, j) => (
              <td key={j} className={`py-1 pr-2 ${j > 0 && !head ? "text-right font-mono" : ""} ${head && j > 0 ? "font-mono" : ""}`}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
