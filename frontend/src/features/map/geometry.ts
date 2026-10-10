// World geometry for the deck.gl map: positions, pipe widths, illustrative flow, terrain.
// Static cosmetic inputs (elevations, diameters) come from the bundled Net3 file: same network the
// backend serves, used only for looks. Everything scenario-related still comes from the API.
import { contours } from "d3-contour";
import type { NetworkResponse } from "../../contracts/types";
import type { Graph } from "../../lib/graph";
import net3 from "../../mock/data/net3.json";
import { hexToRgb, type Palette } from "../../ui/tokens";

export const VIEW_W = 1000;

export interface World {
  pos: Map<string, [number, number]>;
  width: number;
  height: number;
}

/** Raw .inp coordinates -> world units (y flipped: EPANET y grows upward, screens grow downward). */
export function layoutWorld(net: NetworkResponse): World {
  const xs = net.nodes.map((n) => n.x);
  const ys = net.nodes.map((n) => n.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = VIEW_W / Math.max(maxX - minX, maxY - minY || 1);
  const pos = new Map<string, [number, number]>(net.nodes.map((n) => [n.id, [(n.x - minX) * scale, (maxY - n.y) * scale]]));
  return { pos, width: (maxX - minX) * scale, height: (maxY - minY) * scale };
}

const DIAMETER_IN = new Map(net3.pipes.map((p) => [p.id, p.diameter]));
/** Pixel width from real pipe diameter (Net3 inches, 8"-99"); unknown ids fall back to 2 px. */
export function pipeWidthPx(pipeId: string): number {
  const d = DIAMETER_IN.get(pipeId);
  if (!d) return 2;
  return Math.max(1.4, Math.min(6.5, 1 + Math.sqrt(d) * 0.55));
}

export interface FlowSegment {
  a: [number, number];
  b: [number, number];
  length: number;
}

/**
 * Illustrative flow direction: away from the fixed-head sources (reservoirs, tanks) by graph distance.
 * Not a hydraulic result; the legend says so.
 */
export function flowSegments(net: NetworkResponse, graph: Graph, world: World): FlowSegment[] {
  const sources = net.nodes.filter((n) => n.type !== "junction").map((n) => n.id);
  const dist = new Map<string, number>();
  for (const s of sources) {
    for (const [id, d] of graph.dijkstra(s).dist) dist.set(id, Math.min(dist.get(id) ?? Infinity, d));
  }
  const out: FlowSegment[] = [];
  for (const p of net.pipes) {
    const pa = world.pos.get(p.from);
    const pb = world.pos.get(p.to);
    if (!pa || !pb) continue;
    const downhill = (dist.get(p.from) ?? 0) <= (dist.get(p.to) ?? 0);
    const [a, b] = downhill ? [pa, pb] : [pb, pa];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length > 1) out.push({ a, b, length });
  }
  return out;
}

export interface Particle {
  seg: FlowSegment;
  phase: number;
}

export function flowParticles(segments: FlowSegment[]): Particle[] {
  const out: Particle[] = [];
  segments.forEach((seg, i) => {
    const n = Math.max(1, Math.min(4, Math.round(seg.length / 45)));
    for (let k = 0; k < n; k++) out.push({ seg, phase: (k / n + ((i * 0.618) % 1)) % 1 });
  });
  return out;
}

/** Particle position at time t (seconds): constant speed in world units, so long mains look slow. */
export function particleAt(p: Particle, t: number, speed = 22): [number, number] {
  const f = (p.phase + (t * speed) / p.seg.length) % 1;
  return [p.seg.a[0] + (p.seg.b[0] - p.seg.a[0]) * f, p.seg.a[1] + (p.seg.b[1] - p.seg.a[1]) * f];
}

// ---------------------------------------------------------------------------------------------
// Terrain: IDW-interpolated elevation grid -> hillshade image + contour rings (plan W1/W9).

const ELEVATION = net3.elevation as Record<string, number>;
const RESERVOIRS = new Set(net3.nodes.filter((n) => n.type === "reservoir").map((n) => n.id));

export interface Terrain {
  image: HTMLCanvasElement;
  bounds: [number, number, number, number]; // left, bottom, right, top (world units)
  contours: [number, number][][];
}

export function buildTerrain(world: World, pal: Palette, gridW = 220): Terrain {
  const pad = 0.12 * Math.max(world.width, world.height);
  const x0 = -pad;
  const y0 = -pad;
  const spanX = world.width + 2 * pad;
  const spanY = world.height + 2 * pad;
  const gridH = Math.max(2, Math.round((gridW * spanY) / spanX));
  // Reservoir "elevation" in Net3 is the water head, not the ground: leave reservoirs out.
  const pts = [...world.pos.entries()]
    .filter(([id]) => ELEVATION[id] !== undefined && !RESERVOIRS.has(id))
    .map(([id, [x, y]]) => ({ x, y, z: ELEVATION[id] }));
  // Smoothing radius (world units^2) keeps IDW from drawing bullseyes around single junctions.
  const SMOOTH = (0.06 * Math.max(world.width, world.height)) ** 2;

  // Inverse-distance weighting (power 2): smooth, cheap for ~100 points.
  const z = new Float64Array(gridW * gridH);
  for (let j = 0; j < gridH; j++) {
    for (let i = 0; i < gridW; i++) {
      const wx = x0 + (i / (gridW - 1)) * spanX;
      const wy = y0 + (j / (gridH - 1)) * spanY;
      let num = 0;
      let den = 0;
      for (const p of pts) {
        const d2 = (p.x - wx) ** 2 + (p.y - wy) ** 2 + SMOOTH;
        const w = 1 / d2;
        num += w * p.z;
        den += w;
      }
      z[j * gridW + i] = num / den;
    }
  }

  // Hillshade: sun from the north-west, 45 degrees up.
  const az = (315 * Math.PI) / 180;
  const alt = (45 * Math.PI) / 180;
  const cell = spanX / gridW;
  const zScale = 6; // exaggerate relief so gentle terrain still reads
  const canvas = document.createElement("canvas");
  canvas.width = gridW;
  canvas.height = gridH;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(gridW, gridH);
  const [br, bg, bb] = hexToRgb(pal.bg);
  const [lr, lg, lb] = hexToRgb(pal.pipeGlow);
  const zs = [...z];
  const zMin = Math.min(...zs);
  const zMax = Math.max(...zs);
  for (let j = 0; j < gridH; j++) {
    for (let i = 0; i < gridW; i++) {
      const at = (ii: number, jj: number) => z[Math.max(0, Math.min(gridH - 1, jj)) * gridW + Math.max(0, Math.min(gridW - 1, ii))];
      const dzdx = ((at(i + 1, j) - at(i - 1, j)) / (2 * cell)) * zScale;
      const dzdy = ((at(i, j + 1) - at(i, j - 1)) / (2 * cell)) * zScale;
      const slope = Math.atan(Math.hypot(dzdx, dzdy));
      const aspect = Math.atan2(dzdy, -dzdx);
      const shade = Math.max(0, Math.cos(Math.PI / 2 - alt) * Math.cos(slope) + Math.sin(Math.PI / 2 - alt) * Math.sin(slope) * Math.cos(az - aspect));
      const h = (z[j * gridW + i] - zMin) / (zMax - zMin || 1);
      // Blend: surface colour lifted toward the pipe-glow hue by light and by height.
      const k = 0.05 + 0.22 * shade + 0.14 * h;
      const o = (j * gridW + i) * 4;
      img.data[o] = br + (lr - br) * k;
      img.data[o + 1] = bg + (lg - bg) * k;
      img.data[o + 2] = bb + (lb - bb) * k;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Contours every 5 m of real elevation, converted back to world units.
  const thresholds: number[] = [];
  for (let v = Math.ceil(zMin / 5) * 5; v < zMax; v += 5) thresholds.push(v);
  const rings: [number, number][][] = [];
  for (const c of contours().size([gridW, gridH]).thresholds(thresholds)(zs)) {
    for (const poly of c.coordinates) {
      for (const ring of poly) {
        rings.push(ring.map(([gx, gy]) => [x0 + (gx / (gridW - 1)) * spanX, y0 + (gy / (gridH - 1)) * spanY] as [number, number]));
      }
    }
  }

  return { image: canvas, bounds: [x0, y0 + spanY, x0 + spanX, y0], contours: rings };
}
