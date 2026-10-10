// The search cloud (plan W2): relative scores diffused along real pipes. A visual aid, not a
// probability map; the legend and chip say so. Inputs are API values only (detect candidates).
import type { Candidate, NetPipe } from "../../contracts/types";
import type { Graph } from "../../lib/graph";

/** Pipe distance over which one candidate's score fades to ~37%. */
const SIGMA_M = 260;
/**
 * Absolute field level (relative-score units) that counts as "inside the search area". Absolute,
 * not normalized: when a crew clears a node its share of the score leaves, and the area shrinks.
 */
const AREA_LEVEL = 0.06;

export interface CloudField {
  /** node id -> absolute field (sum of score x decay); feeds the heatmap weights. */
  value: Map<string, number>;
  /** Total pipe length (m) with both ends inside the search area. */
  searchLengthM: number;
  /** Set when the crew confirmed the leak: the cloud is a single point. */
  pinpointed: string | null;
}

const distCache = new WeakMap<Graph, Map<string, Map<string, number>>>();
function distancesFrom(graph: Graph, id: string): Map<string, number> {
  let byGraph = distCache.get(graph);
  if (!byGraph) distCache.set(graph, (byGraph = new Map()));
  let d = byGraph.get(id);
  if (!d) byGraph.set(id, (d = graph.dijkstra(id).dist));
  return d;
}

export function cloudKey(candidates: Candidate[], status: string, foundAt: string | null): string {
  return `${status}|${foundAt ?? ""}|${candidates.map((c) => `${c.node}:${c.score}`).join(",")}`;
}

export function cloudField(graph: Graph, candidates: Candidate[], pipes: NetPipe[], foundAt: string | null): CloudField {
  const value = new Map<string, number>();
  if (foundAt) {
    value.set(foundAt, 1);
    return { value, searchLengthM: 0, pinpointed: foundAt };
  }
  for (const c of candidates) {
    if (c.score <= 0) continue;
    for (const [id, d] of distancesFrom(graph, c.node)) {
      if (d > SIGMA_M * 4) continue;
      value.set(id, (value.get(id) ?? 0) + c.score * Math.exp(-d / SIGMA_M));
    }
  }
  let searchLengthM = 0;
  for (const p of pipes) {
    if ((value.get(p.from) ?? 0) >= AREA_LEVEL && (value.get(p.to) ?? 0) >= AREA_LEVEL) searchLengthM += p.length;
  }
  return { value, searchLengthM, pinpointed: null };
}
