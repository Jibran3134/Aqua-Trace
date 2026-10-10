// In-browser mock of the FastAPI backend. Routes (method, path, body) to the same JSON and HTTP
// statuses as contracts/api.md, including the {"error":{code,message,hint}} format, so the UI
// exercises identical code paths against mocks and the real server.
import type {
  ErrorBody,
  ErrorCode,
  FieldResultResponse,
  HealthResponse,
  LeakSize,
  NetworkResponse,
  NodeId,
  NoiseLevel,
  RevealResponse,
  ScenarioResponse,
} from "../contracts/types";
import { currentRanking, recordFieldResult, scriptedStep } from "./agent";
import { detect, fitAll, round } from "./detector";
import { evaluationReport } from "./evaluate";
import { defaultSensors, loadNet, observe, simulate, type Net } from "./physics";
import type { ScenarioState } from "./state";

export interface MockResult {
  status: number;
  body: unknown;
}

const MAX_SCENARIOS = 200;
const SIZES: LeakSize[] = ["small", "medium", "large"];
const NOISES: NoiseLevel[] = ["low", "mid", "high"];

class HttpError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly hint: string;
  constructor(status: number, code: ErrorCode, message: string, hint: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.hint = hint;
  }
}

const notFound = (id: string) =>
  new HttpError(404, "scenario_not_found", `Scenario ${id} does not exist.`, "Scenario expired after a server restart; simulate again.");
const invalid = (message: string, hint: string) => new HttpError(422, "validation_error", message, hint);

export class MockBackend {
  private readonly net: Net;
  private readonly scenarios = new Map<string, ScenarioState>();
  private counter = 0;
  private readonly bootedAt = Date.now();
  private readonly signaturesBuildMs: number;

  /** @param signaturesBuildMs simulate the backend's signature build on startup (0 = ready at once). */
  constructor(signaturesBuildMs = 0) {
    this.net = loadNet();
    this.signaturesBuildMs = signaturesBuildMs;
  }

  handle(method: string, path: string, body: unknown = {}): MockResult {
    try {
      return { status: 200, body: this.route(method.toUpperCase(), path.replace(/\/+$/, "") || "/", (body ?? {}) as Record<string, unknown>) };
    } catch (e) {
      if (e instanceof HttpError) {
        const err: ErrorBody = { error: { code: e.code, message: e.message, hint: e.hint } };
        return { status: e.status, body: err };
      }
      const err: ErrorBody = { error: { code: "internal_error", message: "Unexpected mock error.", hint: String(e) } };
      return { status: 500, body: err };
    }
  }

  private route(method: string, path: string, body: Record<string, unknown>): unknown {
    if (method === "GET" && path === "/health") return this.health();
    if (method === "GET" && path === "/network") return this.network();
    if (method === "POST" && path === "/scenario/leak") return this.leak(body);
    if (method === "POST" && path === "/detect") return this.detect(body);
    if (method === "POST" && path === "/agent/step") return this.agentStep(body);
    if (method === "POST" && path === "/field/result") return this.fieldResult(body);
    if (method === "GET" && path === "/eval") return evaluationReport(this.net);
    const reveal = path.match(/^\/scenario\/([^/]+)\/reveal$/);
    if (method === "GET" && reveal) return this.reveal(decodeURIComponent(reveal[1]));
    throw new HttpError(404, "internal_error", `No mock for ${method} ${path}.`, "This endpoint lands in a later module; check contracts/api.md.");
  }

  private requireReady() {
    const h = this.health();
    if (!h.signatures_ready) {
      throw new HttpError(503, "signatures_not_ready", "Leak signature library is still building.", `About ${Math.round((h.progress ?? 0) * 100)}% done; try again in a few seconds.`);
    }
  }

  private scenario(body: Record<string, unknown>): ScenarioState {
    const id = body.scenario_id;
    if (typeof id !== "string" || !id) throw invalid("scenario_id is required.", "Simulate a leak first.");
    const st = this.scenarios.get(id);
    if (!st) throw notFound(id);
    return st;
  }

  // ---------- endpoints ----------

  health(): HealthResponse {
    const progress = this.signaturesBuildMs ? Math.min(1, (Date.now() - this.bootedAt) / this.signaturesBuildMs) : 1;
    return { status: "ok", signatures_ready: progress >= 1, progress: round(progress, 2) };
  }

  network(): NetworkResponse {
    return { nodes: this.net.nodes, pipes: this.net.pipes, default_sensors: defaultSensors(this.net) };
  }

  leak(body: Record<string, unknown>): ScenarioResponse {
    this.requireReady();
    const { seed: rawSeed, size, noise = "mid", sensors: rawSensors, k = 6 } = body;
    if (rawSeed !== undefined && rawSeed !== null && (!Number.isInteger(rawSeed) || (rawSeed as number) < 0)) {
      throw invalid("seed must be a non-negative integer.", "Leave the seed blank for a random scenario.");
    }
    if (size !== undefined && !SIZES.includes(size as LeakSize)) throw invalid(`size must be one of ${SIZES.join(", ")}.`, "Pick small, medium or large.");
    if (!NOISES.includes(noise as NoiseLevel)) throw invalid(`noise must be one of ${NOISES.join(", ")}.`, "Pick low, mid or high.");
    if (!Number.isInteger(k) || (k as number) < 1 || (k as number) > 20) throw invalid("k must be an integer between 1 and 20.", "Use 3, 6 or 10 sensors.");

    let sensors: NodeId[];
    if (Array.isArray(rawSensors) && rawSensors.length) {
      const bad = rawSensors.filter((s) => typeof s !== "string" || !this.net.signature.has(s));
      if (bad.length) throw invalid(`Unknown sensor node(s): ${bad.join(", ")}.`, "Sensors must be junction ids from GET /network.");
      sensors = [...new Set(rawSensors as NodeId[])];
    } else {
      sensors = defaultSensors(this.net, k as number);
    }

    const seed = typeof rawSeed === "number" ? rawSeed : Math.floor(Math.random() * 1_000_000);
    const sim = simulate(this.net, seed, { size: size as LeakSize | undefined, noise: noise as NoiseLevel });
    const readings = observe(this.net, sim, sensors);
    const fit = fitAll(this.net, readings, sim.noiseSigma);
    const id = `sc_${(++this.counter).toString(36)}${seed.toString(36)}`;

    this.scenarios.set(id, {
      id,
      sim,
      sensors,
      readings,
      live: fit.live,
      residual: fit.residual,
      fits: fit.fits,
      likelihood: fit.likelihood,
      weights: new Map(),
      inspected: new Set(),
      inspectionOrder: [],
      resolved: false,
      abstained: false,
      foundAt: null,
      turns: 0,
      createdAt: Date.now(),
    });
    if (this.scenarios.size > MAX_SCENARIOS) this.scenarios.delete(this.scenarios.keys().next().value!);

    return {
      scenario_id: id,
      seed,
      sensors,
      readings,
      meta: { time_step: "t0", noise_sigma: sim.noiseSigma, noise_level: sim.noiseLevel, demand_mult_known: false },
    };
  }

  detect(body: Record<string, unknown>) {
    this.requireReady();
    const st = this.scenario(body);
    return detect(this.net, st.readings, st.sensors, st.sim.noiseLevel, st.sim.noiseSigma, st.weights).response;
  }

  agentStep(body: Record<string, unknown>) {
    this.requireReady();
    const st = this.scenario(body);
    const mode = body.mode ?? "auto";
    if (!["auto", "scripted", "llm"].includes(mode as string)) throw invalid("mode must be auto, scripted or llm.", "Use auto.");
    // The mock has no LLM: every mode runs the scripted investigator, as the real fallback does.
    return scriptedStep(this.net, st);
  }

  fieldResult(body: Record<string, unknown>): FieldResultResponse {
    const st = this.scenario(body);
    if (typeof body.found !== "boolean") throw invalid("found must be true or false.", "Report what the crew found.");
    if (typeof body.node !== "string" || !this.net.signature.has(body.node)) {
      throw invalid(`Unknown node ${String(body.node)}.`, "Report on a candidate node from /detect.");
    }
    const already = st.inspected.has(body.node) && !body.found;
    recordFieldResult(this.net, st, body.node, body.found);
    return {
      state: st.resolved ? "resolved" : "investigating",
      ranking: currentRanking(this.net, st)
        .slice(0, 10)
        .map((r) => ({ node: r.node, score: round(r.score, 4) })),
      note: already ? `Node ${body.node} was already reported; no change.` : null,
    };
  }

  reveal(id: string): RevealResponse {
    const st = this.scenarios.get(id);
    if (!st) throw notFound(id);
    const truth = st.sim.trueLeakNode!;
    const ranking = currentRanking(this.net, st);
    const rank = ranking.findIndex((r) => r.node === truth) + 1;
    return {
      true_leak_node: truth,
      true_size: st.sim.trueSize!,
      rank_of_truth: rank,
      hop_error_top1: this.net.hopsFrom(ranking[0].node).get(truth) ?? -1,
    };
  }
}
