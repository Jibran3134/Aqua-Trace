// Parses backend/data/Net3.inp into the GET /network payload shape (minus default_sensors,
// which the mock engine computes). Output feeds the in-browser mock engine.
// Usage: node scripts/build-network.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const INP = resolve(here, "../../backend/data/Net3.inp");
const OUT = resolve(here, "../src/mock/data/net3.json");

function sections(text) {
  const out = {};
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split(";")[0].trim();
    const header = line.match(/^\[(.+)]$/);
    if (header) {
      current = header[1].toUpperCase();
      out[current] ??= [];
      continue;
    }
    if (current && line) out[current].push(line.split(/\s+/));
  }
  return out;
}

const s = sections(readFileSync(INP, "utf8"));
// Net3 is in US units (ft). WNTR converts to SI, so the mock serves metres like the real backend.
const FT = 0.3048;
const m = (ft) => Math.round(+ft * FT * 10) / 10;
const coords = new Map(s.COORDINATES.map(([id, x, y]) => [id, { x: +x, y: +y }]));

const nodes = [];
const elevation = {};
for (const [id, elev] of s.JUNCTIONS) {
  nodes.push({ id, ...coords.get(id), type: "junction" });
  elevation[id] = m(elev);
}
for (const [id, head] of s.RESERVOIRS) {
  nodes.push({ id, ...coords.get(id), type: "reservoir" });
  elevation[id] = m(head);
}
for (const [id, elev] of s.TANKS) {
  nodes.push({ id, ...coords.get(id), type: "tank" });
  elevation[id] = m(elev);
}

const pipes = [
  ...s.PIPES.map(([id, from, to, length, diameter]) => ({ id, from, to, length: m(length), diameter: +diameter, kind: "pipe" })),
  ...(s.PUMPS ?? []).map(([id, from, to]) => ({ id, from, to, length: 0, diameter: 0, kind: "pump" })),
  ...(s.VALVES ?? []).map(([id, from, to]) => ({ id, from, to, length: 0, diameter: 0, kind: "valve" })),
];

const missing = nodes.filter((n) => n.x === undefined);
if (missing.length) throw new Error(`nodes without coordinates: ${missing.map((n) => n.id)}`);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ nodes, pipes, elevation }));
console.log(`net3.json: ${nodes.length} nodes, ${pipes.length} links -> ${OUT}`);
