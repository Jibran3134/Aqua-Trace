/**
 * Integration smoke test: run live backend payloads through src/api/adapt.ts and
 * assert the invariants the UI depends on.
 *
 *   cd backend; docker compose up -d        # wait for signatures_ready
 *   cd frontend; npm run verify:backend
 *
 * Unit tests pin the mapping against payloads copied from the backend schema;
 * this checks the real server, so a backend rename fails here first.
 */
import {
  adaptHealth,
  adaptNetwork,
  adaptReveal,
  adaptScenario,
} from "../src/api/adapt";

const BASE = (process.env.AQUATRACE_URL ?? "http://localhost:8000").replace(/\/+$/, "");

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

async function get(path: string) {
  const r = await fetch(`${BASE}${path}`, { headers: { Origin: "http://localhost:5173" } });
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}

async function post(path: string, body: unknown) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:5173" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}

async function main() {
  console.log(`\nVerifying ${BASE}\n`);

  console.log("GET /health");
  const rawHealth = await get("/health");
  const health = adaptHealth(rawHealth);
  check("signatures are ready", health.signatures_ready === true, `raw=${JSON.stringify(rawHealth)}`);
  check(
    "progress is a 0..1 fraction, not a percentage",
    health.progress !== undefined && health.progress >= 0 && health.progress <= 1,
    `raw signatures_progress=${rawHealth.signatures_progress} -> progress=${health.progress}`,
  );
  check("dependencies are up", health.database !== "unavailable" && health.redis !== "unavailable");

  console.log("\nGET /network");
  const rawNet = await get("/network");
  const net = adaptNetwork(rawNet);
  check("nodes and pipes present", net.nodes.length > 0 && net.pipes.length > 0, `${net.nodes.length} nodes, ${net.pipes.length} pipes`);
  check("every pipe has a `kind` the stylesheet understands", net.pipes.every((p) => ["pipe", "pump", "valve"].includes(p.kind ?? "")));
  const pumps = net.pipes.filter((p) => p.kind === "pump");
  check("pumps survive the type -> kind mapping", pumps.length > 0, `${pumps.length} pumps: ${pumps.map((p) => p.id).join(", ")}`);
  const ids = new Set(net.nodes.map((n) => n.id));
  check("pipe endpoints all resolve to nodes", net.pipes.every((p) => ids.has(p.from) && ids.has(p.to)));
  check("default sensors are junctions", net.default_sensors.every((s) => net.nodes.find((n) => n.id === s)?.type === "junction"));

  console.log("\nPOST /scenario/leak");
  const req = { seed: 7, noise: "mid" as const, k: 6 };
  const rawLeak = await post("/scenario/leak", req);
  const scenario = adaptScenario(rawLeak, req);
  check("seed is recovered from the request", scenario.seed === 7, `backend echoed seed: ${"seed" in rawLeak}`);
  check("noise level is recovered", scenario.meta.noise_level === "mid");
  check("readings keys match sensors", JSON.stringify([...scenario.sensors].sort()) === JSON.stringify(Object.keys(scenario.readings).sort()));
  check("no truth in the scenario payload", !JSON.stringify(rawLeak).includes("true_leak_node"));

  console.log("\nPOST /detect");
  const detect = await post("/detect", { scenario_id: scenario.scenario_id });
  const scores = detect.candidates.map((c: { score: number }) => c.score);
  check("status is a contract value", ["ok", "insufficient_evidence"].includes(detect.status), detect.status);
  check("candidates are sorted by score", scores.every((s: number, i: number) => i === 0 || scores[i - 1] >= s));
  check("every candidate node exists", detect.candidates.every((c: { node: string }) => ids.has(c.node)));
  check("no truth in the detect payload", !JSON.stringify(detect).includes("true_leak_node"));

  console.log("\nGET /scenario/{id}/reveal");
  const reveal = adaptReveal(await get(`/scenario/${scenario.scenario_id}/reveal`));
  check("truth node exists in the network", ids.has(reveal.true_leak_node), reveal.true_leak_node);
  check("rank and hop error are numbers the UI can format", Number.isFinite(reveal.rank_of_truth) && Number.isFinite(reveal.hop_error_top1), `rank=${reveal.rank_of_truth} hops=${reveal.hop_error_top1}`);

  console.log(
    failures === 0
      ? "\nAll checks passed: the frontend contract matches the live backend.\n"
      : `\n${failures} check(s) failed.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`\nVerification could not run: ${e instanceof Error ? e.message : String(e)}`);
  console.error("Is the backend up? cd backend; docker compose up -d\n");
  process.exit(1);
});
