import { WifiOff } from "lucide-react";
import { useStore } from "../../state/store";
import { Prov, cn } from "../../ui/primitives";

export function ReadingsTable() {
  const scenario = useStore((s) => s.scenario);
  const flyTo = useStore((s) => s.flyTo);
  const setHover = useStore((s) => s.setHover);
  if (!scenario) return null;
  return (
    <div className="overflow-hidden rounded-xl ring-1 ring-ink-700">
      <table className="w-full text-[0.85rem]">
        <thead className="bg-ink-800/80 text-left text-[0.8rem] uppercase tracking-wider text-silt">
          <tr>
            <th className="px-3 py-2 font-semibold">Sensor</th>
            <th className="px-3 py-2 text-right font-semibold">
              Pressure <Prov kind="simulated reading" className="ml-1 normal-case" />
            </th>
          </tr>
        </thead>
        <tbody>
          {scenario.sensors.map((id) => {
            const v = scenario.readings[id];
            return (
              <tr
                key={id}
                className="cursor-pointer border-t border-ink-700/70 hover:bg-ink-800"
                onClick={() => flyTo(id)}
                onMouseEnter={() => setHover(id)}
                onMouseLeave={() => setHover(null)}
              >
                <td className="px-3 py-1.5">
                  <span className="inline-flex items-center gap-2">
                    <svg viewBox="0 0 10 10" className={cn("size-2.5", v === null ? "fill-silt-dim" : "fill-phosphor")}>
                      <path d="M5 0 10 5 5 10 0 5Z" />
                    </svg>
                    <span className="num">{id}</span>
                  </span>
                </td>
                <td className="num px-3 py-1.5 text-right">
                  {v === null ? (
                    <span className="inline-flex items-center gap-1 text-vermilion">
                      <WifiOff className="size-3.5" /> sensor offline
                    </span>
                  ) : (
                    <>
                      {v.toFixed(2)} <span className="text-silt">m</span>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
