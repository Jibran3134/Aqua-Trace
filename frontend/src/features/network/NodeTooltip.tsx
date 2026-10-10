import { useStore } from "../../state/store";
import { Prov } from "../../ui/primitives";

export function NodeTooltip({ project }: { project: (id: string) => { x: number; y: number } | null }) {
  const hover = useStore((s) => s.hoverNode);
  const network = useStore((s) => s.network);
  const scenario = useStore((s) => s.scenario);
  const detection = useStore((s) => s.detection);
  const reveal = useStore((s) => s.reveal);
  if (!hover || !network) return null;
  const p = project(hover);
  const node = network.nodes.find((n) => n.id === hover);
  if (!p || !node) return null;

  const rank = detection?.candidates.findIndex((c) => c.node === hover) ?? -1;
  const cand = rank >= 0 ? detection!.candidates[rank] : null;
  const isSensor = (scenario?.sensors ?? network.default_sensors).includes(hover);
  const reading = scenario?.readings[hover];

  return (
    <div
      className="pointer-events-none absolute z-30 min-w-44 -translate-x-1/2 rounded-xl bg-ink-850/95 px-3 py-2 text-[0.8rem] shadow-lift ring-1 ring-ink-600 backdrop-blur"
      style={{ left: p.x, top: p.y + 16 }}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="num font-bold text-limestone">{node.id}</span>
        <span className="text-[0.7rem] capitalize text-silt">{isSensor ? "sensor · junction" : node.type}</span>
      </div>
      {isSensor && scenario && (
        <div className="mt-1 flex items-baseline justify-between gap-3">
          {reading === null ? (
            <span className="text-vermilion">sensor offline</span>
          ) : (
            <span className="num text-phosphor">{reading?.toFixed(2)} m</span>
          )}
          <Prov kind="simulated reading" />
        </div>
      )}
      {cand && (
        <div className="mt-1 space-y-0.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-silt">rank {rank + 1}</span>
            <span className="num text-saffron">{cand.score.toFixed(3)}</span>
          </div>
          <Prov kind="relative score" />
        </div>
      )}
      {reveal?.true_leak_node === hover && <div className="mt-1 font-semibold text-tracer">True leak location</div>}
    </div>
  );
}
