import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import { Maximize2, Minus, Plus } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { NetworkResponse } from "../../contracts/types";
import { normalizeToTop, rampColor } from "../../lib/score";
import { useStore } from "../../state/store";
import { cn } from "../../ui/primitives";
import { Legend } from "./Legend";
import { NodeTooltip } from "./NodeTooltip";

const VIEW_W = 1000;
const FRAME_MAX_ZOOM = 2.2;
const C = {
  pipe: "#2c4b48",
  pump: "#8fa6a0",
  junction: "#4f7b74",
  limestone: "#e8e2d0",
  ink: "#071316",
  phosphor: "#d4f26a",
  tracer: "#b48cff",
  verdigris: "#3fbfa6",
  silt: "#62807a",
};

/** Maps raw .inp coordinates into a fixed view box once (y flipped: EPANET y grows upward). */
function layout(net: NetworkResponse): Record<string, { x: number; y: number }> {
  const xs = net.nodes.map((n) => n.x);
  const ys = net.nodes.map((n) => n.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = VIEW_W / Math.max(maxX - minX, maxY - minY || 1);
  return Object.fromEntries(net.nodes.map((n) => [n.id, { x: (n.x - minX) * scale, y: (maxY - n.y) * scale }]));
}

const STYLE: cytoscape.StylesheetJson = [
  {
    selector: "node",
    style: {
      width: 9,
      height: 9,
      "background-color": C.junction,
      "border-width": 0,
      label: "",
      color: C.limestone,
      "font-family": "JetBrains Mono Variable, monospace",
      "font-size": 13,
      "font-weight": 600,
      "text-outline-color": C.ink,
      "text-outline-width": 3,
      "text-valign": "top",
      "text-margin-y": -6,
      "transition-property": "background-color, width, height, border-width, border-color, opacity",
      "transition-duration": 450,
    },
  },
  {
    selector: "node[type = 'reservoir']",
    style: { shape: "round-rectangle", width: 26, height: 18, "background-color": "#1f7f70", "border-width": 2, "border-color": C.verdigris, label: "data(id)", "font-family": "Instrument Sans Variable, sans-serif", "font-size": 14 },
  },
  {
    selector: "node[type = 'tank']",
    style: { shape: "barrel", width: 18, height: 22, "background-color": "#13292e", "border-width": 2, "border-color": C.verdigris, label: "data(label)", "font-family": "Instrument Sans Variable, sans-serif", "font-size": 13 },
  },
  {
    selector: "node.candidate",
    style: { "background-color": "data(color)", width: "data(size)", height: "data(size)", "z-index": 5 },
  },
  {
    selector: "node.top",
    style: { "border-width": 2.5, "border-color": C.limestone, "z-index": 10 },
  },
  {
    selector: "node.sensor",
    style: {
      shape: "diamond",
      width: 20,
      height: 20,
      "background-color": C.phosphor,
      "border-width": 2,
      "border-color": C.ink,
      label: "data(id)",
      color: C.phosphor,
      "z-index": 20,
    },
  },
  { selector: "node.sensor.offline", style: { "background-color": "#3a4a46", color: C.silt, "border-color": C.silt, "border-style": "dashed" } },
  { selector: "node.truth", style: { "border-width": 4, "border-color": C.tracer, "z-index": 30 } },
  { selector: "node.suggested", style: { "border-width": 3, "border-color": C.phosphor, "border-style": "dashed", label: "data(id)", color: C.phosphor, "z-index": 25 } },
  { selector: "node.hover", style: { "border-width": 3, "border-color": C.limestone } },
  {
    selector: "edge",
    style: { width: 2.2, "line-color": C.pipe, "curve-style": "straight", "transition-property": "line-color, width, opacity", "transition-duration": 450 },
  },
  { selector: "edge[kind = 'pump']", style: { "line-style": "dashed", "line-color": C.pump, width: 2.5 } },
  { selector: "edge.adjacent", style: { "line-color": "data(color)", width: 4 } },
  { selector: "node.cleared", style: { "background-color": "#2b3b39", "border-width": 2, "border-color": C.silt, "border-style": "dashed", width: 11, height: 11, "z-index": 6 } },
  {
    selector: "edge.route",
    style: { "line-color": "#6fe0c7", width: 4.5, "line-style": "dashed", "line-dash-pattern": [9, 6], "line-cap": "round", "z-index": 15 },
  },
  { selector: "edge.truthpath", style: { "line-color": C.tracer, width: 3.5, "line-style": "dashed", "line-dash-pattern": [6, 5], "z-index": 9 } },
];

export function NetworkCanvas() {
  const network = useStore((s) => s.network);
  const scenario = useStore((s) => s.scenario);
  const detection = useStore((s) => s.detection);
  const reveal = useStore((s) => s.reveal);
  const graph = useStore((s) => s.graph);
  const flyTarget = useStore((s) => s.flyTarget);
  const agent = useStore((s) => s.agent);
  const setHover = useStore((s) => s.setHover);
  const setFocus = useStore((s) => s.setFocus);

  const host = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [tick, setTick] = useState(0); // bumps on pan/zoom so overlays re-project

  const positions = useMemo(() => (network ? layout(network) : {}), [network]);

  // Build the graph once per network.
  useEffect(() => {
    if (!network || !host.current) return;
    const elements: ElementDefinition[] = [
      ...network.nodes.map((n) => ({
        data: { id: n.id, type: n.type, label: n.type === "tank" ? `Tank ${n.id}` : n.id },
        position: positions[n.id],
      })),
      ...network.pipes.map((p) => ({ data: { id: `p:${p.id}`, pipe: p.id, source: p.from, target: p.to, kind: p.kind ?? "pipe" } })),
    ];
    const cy = cytoscape({
      container: host.current,
      elements,
      style: STYLE,
      layout: { name: "preset", fit: true, padding: 48 },
      minZoom: 0.3,
      maxZoom: 5,
      boxSelectionEnabled: false,
      autoungrabify: true,
    });
    cyRef.current = cy;
    const bump = () => setTick((t) => t + 1);
    cy.on("viewport resize", bump);
    cy.on("mouseover", "node", (e) => {
      e.target.addClass("hover");
      setHover(e.target.id());
      if (host.current) host.current.style.cursor = "pointer";
    });
    cy.on("mouseout", "node", (e) => {
      e.target.removeClass("hover");
      setHover(null);
      if (host.current) host.current.style.cursor = "";
    });
    cy.on("tap", "node", (e) => setFocus(e.target.id()));
    const ro = new ResizeObserver(() => {
      cy.resize();
      cy.fit(undefined, 48);
    });
    ro.observe(host.current);
    bump();
    return () => {
      ro.disconnect();
      cy.destroy();
      cyRef.current = null;
    };
  }, [network, positions, setHover, setFocus]);

  // Paint scenario state: sensors, candidate heat, truth.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !network) return;
    cy.batch(() => {
      cy.elements().removeClass("sensor offline candidate top truth suggested adjacent truthpath route cleared");
      const sensors = scenario?.sensors ?? network.default_sensors;
      for (const id of sensors) {
        const n = cy.getElementById(id);
        n.addClass("sensor");
        if (scenario && scenario.readings[id] === null) n.addClass("offline");
      }
      if (detection) {
        const top = detection.candidates[0]?.score ?? 0;
        detection.candidates.forEach((c, i) => {
          const t = normalizeToTop(c.score, top);
          const color = rampColor(detection.status === "ok" ? t : t * 0.35);
          const n = cy.getElementById(c.node);
          n.data({ color, size: 10 + 10 * t });
          n.addClass("candidate");
          if (i < 3 && detection.status === "ok") {
            n.addClass("top");
            n.connectedEdges().forEach((e) => {
              e.data("color", color);
              e.addClass("adjacent");
            });
          }
        });
        if (detection.recommended_sensor) cy.getElementById(detection.recommended_sensor).addClass("suggested");
      }
      for (const id of agent.cleared) cy.getElementById(id).addClass("cleared");
      if (agent.state === "abstained" && agent.recommended) cy.getElementById(agent.recommended).addClass("suggested");
      if (agent.state === "investigating" && graph && agent.route.length) {
        graph.routePipes(agent.route).forEach((p) => cy.getElementById(`p:${p}`).addClass("route"));
      }
      if (reveal) {
        cy.getElementById(reveal.true_leak_node).addClass("truth");
        const top1 = detection?.candidates[0]?.node;
        if (top1 && graph && top1 !== reveal.true_leak_node) {
          const path = graph.shortestPath(top1, reveal.true_leak_node);
          path?.pipes.forEach((p) => cy.getElementById(`p:${p}`).addClass("truthpath"));
        }
      }
    });
  }, [network, scenario, detection, reveal, graph, agent]);

  // Marching dashes on the crew route: reads as "a crew is moving" from the back of the room.
  const hasRoute = agent.state === "investigating" && agent.route.length > 0;
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !hasRoute) return;
    let raf = 0;
    let offset = 0;
    const step = () => {
      offset = (offset - 0.6) % 1500;
      cy.edges(".route").style("line-dash-offset", offset);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [hasRoute]);

  // Fly to a node when asked (candidate list clicks, reveal).
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !flyTarget) return;
    const eles = cy.nodes().filter((n) => flyTarget.ids.includes(n.id()));
    if (eles.empty()) return;
    if (eles.length === 1) {
      cy.animate({ center: { eles }, zoom: Math.max(cy.zoom(), 1.6) }, { duration: 650, easing: "ease-in-out-cubic" });
    } else {
      // Two hops of context around the cluster keeps the fit from zooming into a single blob.
      const context = eles.closedNeighborhood().closedNeighborhood().nodes();
      const bb = context.boundingBox();
      const pad = 70;
      // Dense districts would otherwise zoom to max; cap so pipes keep their context.
      const zoom = Math.min(FRAME_MAX_ZOOM, (cy.width() - 2 * pad) / Math.max(bb.w, 1), (cy.height() - 2 * pad) / Math.max(bb.h, 1));
      cy.animate({ zoom, center: { eles: context } }, { duration: 800, easing: "ease-in-out-cubic" });
    }
  }, [flyTarget]);

  const resetView = () => cyRef.current?.animate({ fit: { eles: cyRef.current.elements(), padding: 48 } }, { duration: 500, easing: "ease-in-out-cubic" });
  const zoomBy = (f: number) => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.animate({ zoom: { level: cy.zoom() * f, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } } }, { duration: 250 });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "r" || e.key === "R") && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLSelectElement)) resetView();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Overlay projections (rank badges, ripples, truth marker, sensor suggestion).
  const project = (id: string) => {
    const cy = cyRef.current;
    const n = cy?.getElementById(id);
    if (!cy || !n || n.empty()) return null;
    return n.renderedPosition();
  };
  void tick;
  const tops = detection?.status === "ok" ? detection.candidates.slice(0, 3) : [];
  // Rank pills sit up-right of their node; adjacent candidates would collide, so stack them.
  const placed: { x: number; y: number }[] = [];
  const pills = tops.map((c) => {
    const p = project(c.node);
    if (!p) return null;
    let dy = 0;
    while (placed.some((q) => Math.abs(q.x - p.x) < 78 && Math.abs(q.y - (p.y + dy)) < 26)) dy -= 26;
    placed.push({ x: p.x, y: p.y + dy });
    return { p, dy };
  });

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl border border-ink-600/70 bg-ink-950/60">
      {/* Engineering grid: reads as a utility map without pretending to be geography. */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(rgb(63 191 166 / 0.06) 1px, transparent 1px), linear-gradient(90deg, rgb(63 191 166 / 0.06) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />
      {/* Cytoscape forces position:relative on its container, so the sizing lives on a wrapper. */}
      <div className="absolute inset-0">
        <div ref={host} className="h-full w-full" aria-label="Water network map" role="img" />
      </div>

      <div className="pointer-events-none absolute inset-0">
        <AnimatePresence>
          {tops.map((c, i) => {
            const pill = pills[i];
            if (!pill) return null;
            const { p, dy } = pill;
            const color = rampColor(normalizeToTop(c.score, tops[0].score));
            return (
              <motion.div
                key={`${c.node}-${i}`}
                initial={{ opacity: 0, scale: 0.4 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.4 }}
                transition={{ delay: i * 0.12, type: "spring", stiffness: 260, damping: 20 }}
                className="absolute"
                style={{ left: p.x, top: p.y }}
              >
                {i === 0 && !reveal && agent.state === "idle" && (
                  <>
                    <span className="absolute -left-6 -top-6 size-12 animate-ripple rounded-full" style={{ boxShadow: `0 0 0 2px ${color}` }} />
                    <span className="absolute -left-6 -top-6 size-12 animate-ripple rounded-full [animation-delay:1.2s]" style={{ boxShadow: `0 0 0 2px ${color}` }} />
                  </>
                )}
                {dy !== 0 && <span className="absolute left-[6px] w-px bg-limestone/40" style={{ top: dy - 14, height: -dy + 6 }} />}
                <span
                  className="num absolute left-[8px] flex h-6 items-center gap-1 whitespace-nowrap rounded-full pl-1 pr-2 text-[0.78rem] font-bold text-ink-950 shadow-lg ring-2 ring-ink-950"
                  style={{ background: color, top: dy - 30 }}
                >
                  <span className="grid size-[18px] place-items-center rounded-full bg-ink-950/25">{i + 1}</span>
                  {c.node}
                </span>
              </motion.div>
            );
          })}
          {reveal &&
            (() => {
              const p = project(reveal.true_leak_node);
              if (!p) return null;
              return (
                <motion.div
                  key="truth"
                  className="absolute"
                  style={{ left: p.x, top: p.y }}
                  initial={{ opacity: 0, scale: 2.4 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: "spring", stiffness: 140, damping: 14 }}
                >
                  <span className="absolute -left-7 -top-7 size-14 rounded-full border-2 border-tracer shadow-glow-tracer" />
                  <span className="absolute -left-7 -top-7 size-14 animate-ripple rounded-full border-2 border-tracer" />
                  <span className="absolute -left-[1px] -top-10 h-6 w-0.5 bg-tracer" />
                  <span className="absolute -left-[1px] top-4 h-6 w-0.5 bg-tracer" />
                  <span className="absolute -left-10 -top-[1px] h-0.5 w-6 bg-tracer" />
                  <span className="absolute left-4 -top-[1px] h-0.5 w-6 bg-tracer" />
                  <span className="absolute -left-12 top-8 whitespace-nowrap rounded-md bg-tracer px-2 py-0.5 font-mono text-[0.72rem] font-bold text-ink-950 shadow-glow-tracer">
                    TRUE LEAK · {reveal.true_leak_node}
                  </span>
                </motion.div>
              );
            })()}
          {agent.state === "investigating" &&
            agent.recommended &&
            (() => {
              const p = project(agent.recommended);
              if (!p) return null;
              return (
                <motion.div
                  key={`inspect-${agent.recommended}`}
                  className="absolute"
                  style={{ left: p.x, top: p.y }}
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ type: "spring", stiffness: 220, damping: 16 }}
                >
                  <span className="absolute -left-7 -top-7 size-14 animate-ripple rounded-full border-2 border-verdigris-bright" />
                  <span className="absolute -left-5 -top-5 size-10 rounded-full border-2 border-verdigris-bright shadow-glow-verdigris" />
                  <span className="absolute -left-10 top-6 whitespace-nowrap rounded-md bg-verdigris-bright px-2 py-0.5 font-mono text-[0.7rem] font-bold text-ink-950">
                    CREW → {agent.recommended}
                  </span>
                </motion.div>
              );
            })()}
          {agent.foundAt &&
            (() => {
              const p = project(agent.foundAt);
              if (!p) return null;
              return (
                <motion.div key={`found-${agent.foundAt}`} className="absolute" style={{ left: p.x, top: p.y }} initial={{ opacity: 0, scale: 1.8 }} animate={{ opacity: 1, scale: 1 }}>
                  <span className="absolute -left-6 -top-6 size-12 rounded-full border-[3px] border-vermilion shadow-glow-vermilion" />
                  <span className="absolute -left-12 -top-12 whitespace-nowrap rounded-md bg-vermilion px-2 py-0.5 font-mono text-[0.7rem] font-bold text-ink-950">
                    CREW: LEAK FOUND
                  </span>
                </motion.div>
              );
            })()}
          {(detection?.recommended_sensor || (agent.state === "abstained" && agent.recommended)) &&
            (() => {
              const p = project(detection?.recommended_sensor ?? agent.recommended!);
              if (!p) return null;
              return (
                <motion.div key="suggest" className="absolute" style={{ left: p.x, top: p.y }} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <span className="absolute -left-6 -top-6 size-12 animate-ripple rounded-full border-2 border-dashed border-phosphor" />
                  <span className="absolute left-5 top-2 whitespace-nowrap rounded-md bg-phosphor/90 px-2 py-0.5 text-[0.72rem] font-bold text-ink-950">
                    + add sensor
                  </span>
                </motion.div>
              );
            })()}
        </AnimatePresence>
      </div>

      <NodeTooltip project={project} />

      <div className="absolute right-3 top-3 flex flex-col gap-1.5">
        <MapButton label="Zoom in" onClick={() => zoomBy(1.3)}>
          <Plus className="size-4" />
        </MapButton>
        <MapButton label="Zoom out" onClick={() => zoomBy(1 / 1.3)}>
          <Minus className="size-4" />
        </MapButton>
        <MapButton label="Reset view (R)" onClick={resetView}>
          <Maximize2 className="size-4" />
        </MapButton>
      </div>
      <Legend />
    </div>
  );
}

function MapButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn("grid size-9 place-items-center rounded-xl bg-ink-850/90 text-limestone-dim ring-1 ring-ink-600 backdrop-blur transition hover:text-limestone hover:ring-verdigris/60")}
    >
      {children}
    </button>
  );
}
