import { useStore } from "../../state/store";
import type { Project } from "../network/MapOverlays";

/**
 * Sensor and source labels as HTML over the map: crisp at any zoom, real fonts, and no deck.gl
 * font-atlas texture (which does not survive React StrictMode's double mount in dev).
 */
export function MapLabels({ project }: { project: Project }) {
  const network = useStore((s) => s.network);
  const scenario = useStore((s) => s.scenario);
  const customSensors = useStore((s) => s.customSensors);
  if (!network) return null;
  const sensors = scenario?.sensors ?? customSensors ?? network.default_sensors;
  const labels = [
    ...network.nodes.filter((n) => n.type !== "junction").map((n) => ({ id: n.id, text: n.type === "tank" ? `Tank ${n.id}` : n.id, cls: "text-limestone-dim" })),
    ...sensors.map((id) => ({ id, text: id, cls: "text-phosphor" })),
  ];
  return (
    <div className="pointer-events-none absolute inset-0">
      {labels.map((l) => {
        const p = project(l.id);
        if (!p) return null;
        return (
          <span
            key={`${l.cls}-${l.id}`}
            className={`num absolute -translate-x-1/2 whitespace-nowrap text-[0.8rem] font-semibold [text-shadow:0_0_3px_var(--color-ink-950),0_0_6px_var(--color-ink-950)] ${l.cls}`}
            style={{ left: p.x, top: p.y - 30 }}
          >
            {l.text}
          </span>
        );
      })}
    </div>
  );
}
