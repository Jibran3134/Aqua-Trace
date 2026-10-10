import { useStore } from "../../state/store";

export function Legend() {
  const detection = useStore((s) => s.detection);
  const reveal = useStore((s) => s.reveal);
  return (
    <div className="absolute bottom-3 left-3 rounded-xl bg-ink-900/85 px-3.5 py-2.5 ring-1 ring-ink-600 backdrop-blur">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.76rem] text-limestone-dim">
        <Item>
          <svg viewBox="0 0 14 14" className="size-3.5">
            <path d="M7 1 13 7 7 13 1 7Z" fill="#d4f26a" />
          </svg>
          Sensor
        </Item>
        <Item>
          <span className="size-2.5 rounded-full bg-[#4f7b74]" />
          Junction
        </Item>
        <Item>
          <span className="h-2.5 w-3.5 rounded-[3px] border-2 border-verdigris bg-verdigris-deep" />
          Reservoir / tank
        </Item>
        <Item>
          <span className="h-0 w-4 border-t-2 border-dashed border-silt" />
          Pump
        </Item>
        {reveal && (
          <Item>
            <span className="size-3 rounded-full border-2 border-tracer" />
            <span className="text-tracer">True leak</span>
          </Item>
        )}
      </div>
      {detection && (
        <div className="mt-2 flex items-center gap-2">
          <span className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-verdigris-bright/80">relative score</span>
          <div className="score-ramp h-2 w-28 rounded-full" />
          <span className="text-[0.7rem] text-silt">low → high</span>
        </div>
      )}
    </div>
  );
}

function Item({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1.5">{children}</span>;
}
