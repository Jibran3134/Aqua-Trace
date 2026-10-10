import { useStore } from "../../state/store";

/** Legend for the deck.gl map: every illustrative layer says so (plan principle 4). */
export function MapLegend() {
  const detection = useStore((s) => s.detection);
  const reveal = useStore((s) => s.reveal);
  const route = useStore((s) => s.agent.route.length > 0 && s.agent.state === "investigating");
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 max-w-[60%] rounded-xl bg-ink-900/85 px-3.5 py-2.5 ring-1 ring-ink-600 backdrop-blur">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.8rem] text-limestone-dim">
        <Item>
          <svg viewBox="0 0 14 14" className="size-3.5">
            <path d="M7 1 13 7 7 13 1 7Z" className="fill-phosphor" />
          </svg>
          Sensor
        </Item>
        <Item>
          <span className="h-1 w-5 rounded-full bg-verdigris" />
          Pipe (width = diameter)
        </Item>
        <Item>
          <span className="size-1.5 rounded-full bg-limestone" />
          Flow · illustrative
        </Item>
        {route && (
          <Item>
            <span className="h-1 w-5 rounded-full bg-verdigris-bright" />
            Crew route
          </Item>
        )}
        {reveal && (
          <Item>
            <span className="size-3 rounded-full border-2 border-tracer" />
            <span className="text-tracer">True leak</span>
          </Item>
        )}
      </div>
      {detection && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[0.8rem] text-limestone-dim">Search cloud</span>
          <div className="score-ramp h-2 w-24 rounded-full" />
          <span className="text-[0.8rem] text-silt">relative score along pipes · visual aid</span>
        </div>
      )}
    </div>
  );
}

function Item({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1.5">{children}</span>;
}
