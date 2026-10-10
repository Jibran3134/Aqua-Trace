// Writes ../mocks/*.json: one consistent story (same scenario across endpoints) produced by the
// in-browser mock engine. Usage: npm run mocks
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentStepResponse, DetectResponse, ScenarioResponse } from "../src/contracts/types";
import { MockBackend } from "../src/mock/engine";

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../../mocks");
mkdirSync(OUT, { recursive: true });

const write = (name: string, body: unknown) => {
  writeFileSync(resolve(OUT, `${name}.json`), JSON.stringify(body, null, 2) + "\n");
  console.log(`mocks/${name}.json`);
};

const b = new MockBackend();
const get = <T>(path: string) => b.handle("GET", path).body as T;
const post = <T>(path: string, body: unknown) => b.handle("POST", path, body).body as T;

write("health", get("/health"));
write("network", get("/network"));

// Main story: a seed where the agent investigates rather than abstains.
let story: { leak: ScenarioResponse; detect: DetectResponse; step: AgentStepResponse } | null = null;
for (let seed = 1000; seed < 1200 && !story; seed++) {
  const leak = post<ScenarioResponse>("/scenario/leak", { seed, noise: "mid", k: 6 });
  const detect = post<DetectResponse>("/detect", { scenario_id: leak.scenario_id });
  if (detect.status !== "ok") continue;
  const step = post<AgentStepResponse>("/agent/step", { scenario_id: leak.scenario_id, mode: "auto" });
  if (step.state === "investigating") story = { leak, detect, step };
}
if (!story) throw new Error("no investigating seed found");
const id = story.leak.scenario_id;
write("scenario_leak", story.leak);
write("detect", story.detect);
write("agent_step", story.step);
write("field_result", post("/field/result", { scenario_id: id, node: story.step.recommended_node, found: false }));
write("agent_step_after_feedback", post("/agent/step", { scenario_id: id }));
const next = (post<AgentStepResponse>("/agent/step", { scenario_id: id })).recommended_node;
post("/field/result", { scenario_id: id, node: next, found: true });
write("agent_step_resolved", post("/agent/step", { scenario_id: id }));
write("reveal", get(`/scenario/${id}/reveal`));

// Honest-failure story: a small leak under high noise that the detector refuses to localize.
for (let seed = 1000; seed < 1400; seed++) {
  const leak = post<ScenarioResponse>("/scenario/leak", { seed, size: "small", noise: "high", k: 6 });
  const detect = post<DetectResponse>("/detect", { scenario_id: leak.scenario_id });
  if (detect.status === "insufficient_evidence" && detect.recommended_sensor) {
    write("detect_insufficient", detect);
    write("agent_step_abstain", post("/agent/step", { scenario_id: leak.scenario_id }));
    break;
  }
}

write("error_404", b.handle("POST", "/detect", { scenario_id: "expired123" }).body);
write("error_422", b.handle("POST", "/scenario/leak", { noise: "extreme" }).body);
write("error_503", new MockBackend(60_000).handle("POST", "/scenario/leak", {}).body);
