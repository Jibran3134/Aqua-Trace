import type { NetPipe, NodeId, PipeId } from "../contracts/types";

/** Pumps/valves have length 0 in the payload; give them a nominal weight so paths stay sane. */
const ZERO_LENGTH_WEIGHT = 1;

export interface Edge {
  to: NodeId;
  pipe: PipeId;
  weight: number;
}

export class Graph {
  readonly adj = new Map<NodeId, Edge[]>();

  constructor(nodeIds: Iterable<NodeId>, pipes: NetPipe[]) {
    for (const id of nodeIds) this.adj.set(id, []);
    for (const p of pipes) {
      const weight = p.length > 0 ? p.length : ZERO_LENGTH_WEIGHT;
      this.adj.get(p.from)?.push({ to: p.to, pipe: p.id, weight });
      this.adj.get(p.to)?.push({ to: p.from, pipe: p.id, weight });
    }
  }

  neighbors(id: NodeId): Edge[] {
    return this.adj.get(id) ?? [];
  }

  adjacentPipes(id: NodeId): PipeId[] {
    return this.neighbors(id).map((e) => e.pipe);
  }

  /** Dijkstra from one source. Returns distance and predecessor maps. */
  dijkstra(source: NodeId): { dist: Map<NodeId, number>; prev: Map<NodeId, { node: NodeId; pipe: PipeId }> } {
    const dist = new Map<NodeId, number>();
    const prev = new Map<NodeId, { node: NodeId; pipe: PipeId }>();
    const done = new Set<NodeId>();
    dist.set(source, 0);
    // Network is ~100 nodes: an O(V^2) scan beats a heap in clarity and is fast enough.
    while (done.size < this.adj.size) {
      let u: NodeId | null = null;
      let best = Infinity;
      for (const [id, d] of dist) {
        if (!done.has(id) && d < best) {
          best = d;
          u = id;
        }
      }
      if (u === null) break;
      done.add(u);
      for (const e of this.neighbors(u)) {
        const nd = best + e.weight;
        if (nd < (dist.get(e.to) ?? Infinity)) {
          dist.set(e.to, nd);
          prev.set(e.to, { node: u, pipe: e.pipe });
        }
      }
    }
    return { dist, prev };
  }

  /** Unweighted hop counts from one source (BFS). */
  hops(source: NodeId): Map<NodeId, number> {
    const out = new Map<NodeId, number>([[source, 0]]);
    const queue = [source];
    while (queue.length) {
      const u = queue.shift()!;
      for (const e of this.neighbors(u)) {
        if (!out.has(e.to)) {
          out.set(e.to, out.get(u)! + 1);
          queue.push(e.to);
        }
      }
    }
    return out;
  }

  /** Shortest path as node and pipe sequences; null when disconnected. */
  shortestPath(from: NodeId, to: NodeId): { nodes: NodeId[]; pipes: PipeId[]; length: number } | null {
    const { dist, prev } = this.dijkstra(from);
    if (!dist.has(to)) return null;
    const nodes: NodeId[] = [to];
    const pipes: PipeId[] = [];
    let cur = to;
    while (cur !== from) {
      const p = prev.get(cur)!;
      pipes.push(p.pipe);
      nodes.push(p.node);
      cur = p.node;
    }
    return { nodes: nodes.reverse(), pipes: pipes.reverse(), length: dist.get(to)! };
  }

  /** Expands an inspection order into the pipes a crew drives along, leg by leg. */
  routePipes(order: NodeId[]): PipeId[] {
    const pipes: PipeId[] = [];
    for (let i = 1; i < order.length; i++) {
      const leg = this.shortestPath(order[i - 1], order[i]);
      if (leg) pipes.push(...leg.pipes);
    }
    return pipes;
  }
}
