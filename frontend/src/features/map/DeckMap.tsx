import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import { Deck, LinearInterpolator, OrthographicView, type PickingInfo } from "@deck.gl/core";
import { BitmapLayer, IconLayer, PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import { Maximize2, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeToTop, rampRgb } from "../../lib/score";
import { useStore } from "../../state/store";
import { easeInOutCubic, ms, prefersReducedMotion } from "../../ui/motion";
import { hexToRgb, palette } from "../../ui/tokens";
import { MapButton, MapOverlays } from "../network/MapOverlays";
import { NodeTooltip } from "../network/NodeTooltip";
import { cloudField, cloudKey, type CloudField } from "./cloud";
import { buildTerrain, flowParticles, flowSegments, layoutWorld, particleAt, pipeWidthPx } from "./geometry";
import { MapLabels } from "./MapLabels";
import { MapLegend } from "./MapLegend";
import { SearchChip } from "./SearchChip";

type RGBA = [number, number, number, number];

/** deck.gl 9 creates its GPU device asynchronously; viewports exist only after that. */
function viewportOf(deck: Deck<OrthographicView> | null) {
  return deck?.isInitialized ? (deck.getViewports()[0] as unknown as { zoom: number; center: number[]; width: number; height: number; project: (p: number[]) => number[] } | undefined) : undefined;
}
const rgba = (hex: string, a = 255): RGBA => [...hexToRgb(hex), a] as RGBA;

interface ViewState {
  target: [number, number, number];
  zoom: number;
}

const FRAME_MAX_ZOOM = 1.15; // log2 scale: ~2.2x, same cap as the Cytoscape map
const SENSOR_ICON = (color: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><path d="M32 4 60 32 32 60 4 32Z" fill="${color}" stroke="#071316" stroke-width="5"/><circle cx="32" cy="32" r="7" fill="#071316"/><path d="M32 26v12M26 32h12" stroke="${color}" stroke-width="3"/></svg>`,
  )}`;

/**
 * deck.gl network map (plan W1/W2): terrain, diameter-scaled pipes, illustrative flow, the search
 * cloud, crew comet. An imperative Deck driven by one rAF loop keeps 60 fps animation out of React.
 */
export function DeckMap() {
  const network = useStore((s) => s.network);
  const graph = useStore((s) => s.graph);
  const state = useStore();
  const pal = useMemo(() => palette(state.theme), [state.theme]);

  const host = useRef<HTMLDivElement>(null);
  const deckRef = useRef<Deck<OrthographicView> | null>(null);
  const live = useRef(state);
  useEffect(() => {
    live.current = state;
  });
  const [screen, setScreen] = useState<Map<string, { x: number; y: number }>>(() => new Map());
  const [search, setSearch] = useState<{ meters: number; pinpointed: string | null } | null>(null);

  const world = useMemo(() => (network ? layoutWorld(network) : null), [network]);
  const terrain = useMemo(() => (world ? buildTerrain(world, pal) : null), [world, pal]);
  const particles = useMemo(() => (network && graph && world ? flowParticles(flowSegments(network, graph, world)) : []), [network, graph, world]);
  const junctions = useMemo(() => network?.nodes.filter((n) => n.type === "junction").map((n) => n.id) ?? [], [network]);

  // ---------- camera helpers ----------
  const size = () => ({ w: host.current?.clientWidth ?? 800, h: host.current?.clientHeight ?? 600 });
  const fitView = (ids: string[] | null, pad = 48, maxZoom = 4): ViewState => {
    const pts = (ids ?? [...(world?.pos.keys() ?? [])]).map((id) => world?.pos.get(id)).filter(Boolean) as [number, number][];
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const { w, h } = size();
    const scale = Math.min((w - 2 * pad) / Math.max(x1 - x0, 1), (h - 2 * pad) / Math.max(y1 - y0, 1));
    return { target: [(x0 + x1) / 2, (y0 + y1) / 2, 0], zoom: Math.min(maxZoom, Math.log2(scale)) };
  };
  const flyTo = (vs: ViewState, duration: number = ms.scene) => {
    deckRef.current?.setProps({
      initialViewState: {
        ...vs,
        transitionDuration: prefersReducedMotion() ? 0 : duration,
        transitionInterpolator: new LinearInterpolator(["target", "zoom"]),
        transitionEasing: easeInOutCubic,
      },
    });
  };

  // ---------- create the Deck once per network ----------
  useEffect(() => {
    if (!host.current || !world) return;
    const deck = new Deck<OrthographicView>({
      parent: host.current,
      views: new OrthographicView({ id: "ortho", flipY: true }),
      initialViewState: fitView(null),
      controller: { inertia: 300, scrollZoom: { smooth: true, speed: 0.02 }, doubleClickZoom: true },
      style: { position: "absolute", inset: "0" },
      getCursor: ({ isHovering, isDragging }) => (isDragging ? "grabbing" : isHovering ? "pointer" : "grab"),
      onHover: (info: PickingInfo) => live.current.setHover((info.object as { id?: string } | null)?.id ?? null),
      onClick: (info: PickingInfo) => {
        const id = (info.object as { id?: string } | null)?.id;
        if (id) live.current.setFocus(id);
      },
      layers: [],
    });
    deckRef.current = deck;
    return () => {
      deck.finalize();
      deckRef.current = null;
    };
    // fitView reads world through closure; recreate only when the network changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world]);

  // ---------- the animation loop: layers + overlay projection ----------
  useEffect(() => {
    const deck = deckRef.current;
    if (!deck || !world || !network || !graph || !terrain) return;
    let raf = 0;
    let lastKey = "";
    const t0 = performance.now();
    let frames = 0;
    let flowOn = !prefersReducedMotion();
    const routeCache = { key: "", path: [] as [number, number][], lengths: [] as number[], total: 0 };
    // Search cloud state: recompute the field only when its inputs change, then ease the displayed
    // weights toward it every frame. That easing IS the bloom / burn-out / collapse animation.
    const fieldCache: { key: string; field: CloudField | null } = { key: "", field: null };
    const shown = new Map<string, number>();
    let lastNow = performance.now();

    const tick = () => {
      if (!deck.isInitialized) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const now = performance.now();
      const t = (now - t0) / 1000;
      const s = live.current;
      // Auto-degrade: if the first 2 s average below ~30 fps (software GL), drop the particles.
      frames++;
      if (flowOn && t > 2 && t < 2.1 && frames / t < 30) flowOn = false;

      const planning = s.tab === "sensors" || s.tab === "repairs";
      const det = planning ? null : s.detection;
      const top = det?.candidates[0]?.score ?? 0;
      const candMap = new Map(det?.candidates.map((c, i) => [c.node, { t: normalizeToTop(c.score, top), i }]) ?? []);
      const sensors = s.scenario?.sensors ?? s.customSensors ?? network.default_sensors;

      // Search cloud (plan W2)
      const key = det ? cloudKey(det.candidates, det.status, s.agent.foundAt) : "";
      if (key !== fieldCache.key) {
        fieldCache.key = key;
        fieldCache.field = det ? cloudField(graph, det.candidates, network.pipes, s.agent.foundAt) : null;
      }
      const field = fieldCache.field;
      const dt = Math.min(0.1, (now - lastNow) / 1000);
      lastNow = now;
      const ease = prefersReducedMotion() ? 1 : 1 - Math.exp(-dt / 0.32);
      const damp = det && det.status !== "ok" ? 0.4 : 1;
      const heat: { p: [number, number]; w: number }[] = [];
      for (const id of junctions) {
        const target = field ? (field.value.get(id) ?? 0) * damp : 0;
        const cur = shown.get(id) ?? 0;
        const next = cur + (target - cur) * ease;
        shown.set(id, next);
        if (next > 0.002) heat.push({ p: world.pos.get(id)!, w: next });
      }

      // Crew route polyline, expanded along real pipes.
      const routeKey = s.agent.state === "investigating" ? s.agent.route.join(">") : "";
      if (routeKey !== routeCache.key) {
        routeCache.key = routeKey;
        const nodes: string[] = [];
        s.agent.route.forEach((id, i) => {
          if (i === 0) return void nodes.push(id);
          const leg = graph.shortestPath(s.agent.route[i - 1], id);
          if (leg) nodes.push(...leg.nodes.slice(1));
        });
        routeCache.path = routeKey ? nodes.map((id) => world.pos.get(id)!).filter(Boolean) : [];
        routeCache.lengths = [0];
        for (let i = 1; i < routeCache.path.length; i++) {
          const [a, b] = [routeCache.path[i - 1], routeCache.path[i]];
          routeCache.lengths.push(routeCache.lengths[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
        }
        routeCache.total = routeCache.lengths[routeCache.lengths.length - 1] ?? 0;
      }
      const along = (d: number): [number, number] => {
        const L = routeCache.lengths;
        let i = 1;
        while (i < L.length - 1 && L[i] < d) i++;
        const f = (d - L[i - 1]) / Math.max(1e-6, L[i] - L[i - 1]);
        const [a, b] = [routeCache.path[i - 1], routeCache.path[i]];
        return [a[0] + (b[0] - a[0]) * Math.min(1, Math.max(0, f)), a[1] + (b[1] - a[1]) * Math.min(1, Math.max(0, f))];
      };
      const comet =
        routeCache.total > 0
          ? Array.from({ length: 8 }, (_, k) => {
              const head = ((t % 2.4) / 2.4) * routeCache.total;
              return { p: along(Math.max(0, head - k * 7)), k };
            })
          : [];

      // Truth hop path on a miss: dotted tracer line.
      const truthDots: [number, number][] = [];
      if (s.reveal && !planning) {
        const top1 = s.detection?.candidates[0]?.node;
        if (top1 && top1 !== s.reveal.true_leak_node) {
          const path = graph.shortestPath(top1, s.reveal.true_leak_node);
          path?.nodes.forEach((id, i, arr) => {
            if (i === 0) return;
            const a = world.pos.get(arr[i - 1])!;
            const b = world.pos.get(id)!;
            const n = Math.max(2, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 6));
            for (let k = 0; k < n; k++) truthDots.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
          });
        }
      }

      deck.setProps({
        layers: [
          new BitmapLayer({ id: "terrain", image: terrain.image, bounds: terrain.bounds, opacity: 1 }),
          new PathLayer({
            id: "contours",
            data: terrain.contours,
            getPath: (d: [number, number][]) => d,
            getColor: rgba(pal.grid, s.theme === "dark" ? 120 : 160),
            getWidth: 1,
            widthUnits: "pixels",
          }),
          new PathLayer({
            id: "pipes-glow",
            data: network.pipes,
            getPath: (p) => [world.pos.get(p.from)!, world.pos.get(p.to)!],
            getColor: rgba(pal.pipeGlow, s.theme === "dark" ? 70 : 90),
            getWidth: (p) => pipeWidthPx(p.id) + 5,
            widthUnits: "pixels",
            capRounded: true,
          }),
          new PathLayer({
            id: "pipes",
            data: network.pipes,
            getPath: (p) => [world.pos.get(p.from)!, world.pos.get(p.to)!],
            getColor: rgba(pal.pipe, 220),
            getWidth: (p) => pipeWidthPx(p.id),
            widthUnits: "pixels",
            capRounded: true,
            jointRounded: true,
          }),
          flowOn &&
            new ScatterplotLayer({
              id: "flow",
              data: particles,
              getPosition: (p) => particleAt(p, t),
              getRadius: 1.8,
              radiusUnits: "pixels",
              getFillColor: rgba(s.theme === "dark" ? "#c8fff2" : "#ffffff", s.theme === "dark" ? 150 : 230),
              updateTriggers: { getPosition: t },
            }),
          heat.length > 0 &&
            new HeatmapLayer({
              id: "cloud",
              data: heat,
              getPosition: (d: { p: [number, number] }) => d.p,
              getWeight: (d: { w: number }) => d.w,
              radiusPixels: 64,
              intensity: 1.6,
              threshold: 0.1,
              colorDomain: [0, 0.32],
              // Faint end fades to fully transparent: no grey halo around weak candidates.
              colorRange: [0.08, 0.3, 0.5, 0.7, 0.85, 1].map((v, i) => [...rampRgb(v), [0, 60, 125, 175, 210, 235][i]] as RGBA),
              aggregation: "SUM",
              updateTriggers: { getWeight: t, getPosition: heat.length },
            }),
          routeCache.path.length > 1 &&
            new PathLayer({
              id: "route-glow",
              data: [routeCache.path],
              getPath: (d: [number, number][]) => d,
              getColor: rgba(pal.route, 70),
              getWidth: 12,
              widthUnits: "pixels",
              capRounded: true,
              jointRounded: true,
            }),
          routeCache.path.length > 1 &&
            new PathLayer({
              id: "route",
              data: [routeCache.path],
              getPath: (d: [number, number][]) => d,
              getColor: rgba(pal.route, 255),
              getWidth: 3,
              widthUnits: "pixels",
              capRounded: true,
              jointRounded: true,
            }),
          comet.length > 0 &&
            new ScatterplotLayer({
              id: "comet",
              data: comet,
              getPosition: (d: { p: [number, number] }) => d.p,
              getRadius: (d: { k: number }) => 6.5 - d.k * 0.7,
              radiusUnits: "pixels",
              getFillColor: (d: { k: number }) => rgba(pal.route, 255 - d.k * 28),
              updateTriggers: { getPosition: t },
            }),
          truthDots.length > 0 &&
            new ScatterplotLayer({
              id: "truth-path",
              data: truthDots,
              getPosition: (d: [number, number]) => d,
              getRadius: 2.4,
              radiusUnits: "pixels",
              getFillColor: rgba(pal.truth, 230),
            }),
          new ScatterplotLayer({
            id: "junctions",
            data: network.nodes.filter((n) => n.type === "junction"),
            pickable: true,
            getPosition: (n) => world.pos.get(n.id)!,
            getRadius: (n) => {
              const c = candMap.get(n.id);
              if (s.agent.cleared.includes(n.id)) return 5;
              if (c) return 4.5 + 7 * c.t;
              return n.id === s.hoverNode ? 6 : 3.2;
            },
            radiusUnits: "pixels",
            getFillColor: (n) => {
              const c = candMap.get(n.id);
              if (s.agent.cleared.includes(n.id)) return rgba(pal.muted, 120);
              if (c) return [...rampRgb(det?.status === "ok" ? c.t : c.t * 0.35), 255] as RGBA;
              if (planning && s.tab === "repairs" && s.backlog.some((b) => b.node === n.id)) return rgba("#ff5a36");
              return rgba(pal.junction, 230);
            },
            stroked: true,
            getLineColor: (n) => {
              const c = candMap.get(n.id);
              if (s.agent.cleared.includes(n.id)) return rgba(pal.muted, 255);
              if (c && c.i < 3) return rgba(pal.text, 255);
              if (n.id === s.hoverNode) return rgba(pal.text, 255);
              return [0, 0, 0, 0];
            },
            lineWidthUnits: "pixels",
            getLineWidth: 2,
            transitions: { getRadius: ms.ui, getFillColor: ms.ui },
            updateTriggers: {
              getRadius: [det, s.agent.cleared, s.hoverNode],
              getFillColor: [det, s.agent.cleared, s.tab, s.backlog],
              getLineColor: [det, s.agent.cleared, s.hoverNode],
            },
          }),
          new ScatterplotLayer({
            id: "sources",
            data: network.nodes.filter((n) => n.type !== "junction"),
            getPosition: (n) => world.pos.get(n.id)!,
            getRadius: 9,
            radiusUnits: "pixels",
            getFillColor: rgba(pal.panel, 255),
            stroked: true,
            getLineColor: rgba(pal.pipe, 255),
            getLineWidth: 2.5,
            lineWidthUnits: "pixels",
          }),
          new IconLayer({
            id: "sensors",
            data: sensors.map((id) => ({ id, offline: s.scenario ? s.scenario.readings[id] === null : false })),
            pickable: true,
            getPosition: (d: { id: string }) => world.pos.get(d.id)!,
            getIcon: (d: { offline: boolean }) => ({
              id: d.offline ? "off" : "on",
              url: SENSOR_ICON(d.offline ? pal.muted : pal.sensor),
              width: 64,
              height: 64,
            }),
            getSize: 24,
            sizeUnits: "pixels",
            updateTriggers: { getIcon: [s.scenario] },
          }),
          planning &&
            s.tab === "sensors" &&
            s.placement &&
            new ScatterplotLayer({
              id: "proposed",
              data: s.placement.sensors.filter((id) => !sensors.includes(id)),
              getPosition: (id: string) => world.pos.get(id)!,
              getRadius: 11,
              radiusUnits: "pixels",
              filled: true,
              getFillColor: rgba(pal.sensor, 40),
              stroked: true,
              getLineColor: rgba(pal.sensor, 255),
              getLineWidth: 2,
              lineWidthUnits: "pixels",
            }),
        ].filter(Boolean),
      });

      // Project nodes for HTML overlays only when the camera moved.
      const vp = viewportOf(deck);
      if (vp) {
        const key = `${vp.width}x${vp.height}@${vp.zoom.toFixed(4)}:${vp.center.map((v) => v.toFixed(2)).join(",")}`;
        if (key !== lastKey) {
          lastKey = key;
          const next = new Map<string, { x: number; y: number }>();
          for (const [id, p] of world.pos) {
            const [x, y] = vp.project([p[0], p[1]]);
            next.set(id, { x, y });
          }
          setScreen(next);
        }
      }
      setSearch((prev) => {
        if (!field) return prev === null ? prev : null;
        const meters = Math.round(field.searchLengthM);
        return prev && prev.meters === meters && prev.pinpointed === field.pinpointed ? prev : { meters, pinpointed: field.pinpointed };
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [world, network, graph, terrain, particles, junctions, pal]);

  // ---------- camera requests from the store ----------
  const flyTarget = state.flyTarget;
  useEffect(() => {
    if (!flyTarget || !world) return;
    if (flyTarget.ids.length === 1) {
      const p = world.pos.get(flyTarget.ids[0]);
      const z = viewportOf(deckRef.current);
      if (p) flyTo({ target: [p[0], p[1], 0], zoom: Math.max(z?.zoom ?? 0, 0.7) });
    } else if (graph) {
      // Two hops of context around the cluster, zoom capped so pipes keep their context.
      const ids = new Set(flyTarget.ids);
      for (const id of flyTarget.ids) for (const e of graph.neighbors(id)) for (const e2 of graph.neighbors(e.to)) ids.add(e.to).add(e2.to);
      flyTo(fitView([...ids], 70, FRAME_MAX_ZOOM));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyTarget]);

  const resetView = () => flyTo(fitView(null), ms.ui * 2);
  const zoomBy = (d: number) => {
    const vp = viewportOf(deckRef.current);
    if (!vp) return;
    flyTo({ target: [vp.center[0], vp.center[1], 0], zoom: vp.zoom + d }, ms.ui);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "r" || e.key === "R") && !(e.target instanceof Element && e.target.closest("input, select, textarea"))) resetView();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const project = (id: string) => screen.get(id) ?? null;

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl border border-ink-600/70 bg-ink-950">
      <div ref={host} className="absolute inset-0" aria-label="Water network map" role="img" />
      <MapLabels project={project} />
      <MapOverlays project={project} />
      <NodeTooltip project={project} />
      <SearchChip search={search} />
      <div className="absolute right-3 top-3 flex flex-col gap-1.5">
        <MapButton label="Zoom in" onClick={() => zoomBy(0.4)}>
          <Plus className="size-4" />
        </MapButton>
        <MapButton label="Zoom out" onClick={() => zoomBy(-0.4)}>
          <Minus className="size-4" />
        </MapButton>
        <MapButton label="Reset view (R)" onClick={resetView}>
          <Maximize2 className="size-4" />
        </MapButton>
      </div>
      <MapLegend />
    </div>
  );
}
