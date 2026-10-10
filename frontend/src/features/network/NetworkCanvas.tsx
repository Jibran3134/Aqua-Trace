import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import { Maximize2, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { NetworkResponse } from "../../contracts/types";
import { normalizeToTop, rampColor } from "../../lib/score";
import { useStore } from "../../state/store";
import { Legend } from "./Legend";
import { NodeTooltip } from "./NodeTooltip";
import { MapButton, MapOverlays } from "./MapOverlays";

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
  {
    selector: "node.proposed",
    style: { shape: "diamond", width: 20, height: 20, "background-opacity": 0.12, "background-color": C.phosphor, "border-width": 2.5, "border-color": C.phosphor, "border-style": "dashed", label: "data(id)", color: C.phosphor, "z-index": 22 },
  },
  { selector: "node.backlog", style: { "background-color": "#ff5a36", "border-width": 2.5, "border-color": C.limestone, width: 14, height: 14, "z-index": 18 } },
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
  const tab = useStore((s) => s.tab);
  const placement = useStore((s) => s.placement);
  const customSensors = useStore((s) => s.customSensors);
  const backlog = useStore((s) => s.backlog);
  const setHover = useStore((s) => s.setHover);
  const setFocus = useStore((s) => s.setFocus);

  const host = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  /** Screen positions of every node, refreshed on pan/zoom/resize; overlays render from this. */
  const [screen, setScreen] = useState<Map<string, { x: number; y: number }>>(() => new Map());

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
    // Project once per animation frame at most (pan/zoom fire many events per frame).
    let frame = 0;
    const bump = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const next = new Map<string, { x: number; y: number }>();
        cy.nodes().forEach((n) => void next.set(n.id(), { ...n.renderedPosition() }));
        setScreen(next);
      });
    };
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
      cancelAnimationFrame(frame);
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
      cy.elements().removeClass("sensor offline candidate top truth suggested adjacent truthpath route cleared proposed backlog");
      if (tab === "repairs") for (const b of backlog) cy.getElementById(b.node).addClass("backlog");
      const sensors = scenario?.sensors ?? customSensors ?? network.default_sensors;
      if (tab === "sensors" && placement) {
        for (const id of placement.sensors) if (!sensors.includes(id)) cy.getElementById(id).addClass("proposed");
      }
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
  }, [network, scenario, detection, reveal, graph, agent, tab, placement, customSensors, backlog]);

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
  const project = (id: string) => screen.get(id) ?? null;
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

      <MapOverlays project={project} />

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

