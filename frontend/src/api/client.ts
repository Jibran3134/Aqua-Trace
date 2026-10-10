import type {
  AgentStepRequest,
  AgentStepResponse,
  DetectResponse,
  ErrorBody,
  ErrorCode,
  EvalResponse,
  FieldResultRequest,
  FieldResultResponse,
  HealthResponse,
  InspectRequest,
  InspectResponse,
  NetworkResponse,
  RepairRequest,
  RepairResponse,
  RevealResponse,
  ScenarioRequest,
  ScenarioResponse,
  SensorPlaceRequest,
  SensorPlaceResponse,
} from "../contracts/types";
import type { MockBackend } from "../mock/engine";

export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS !== "false";
export const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:8000").replace(/\/+$/, "");
const MOCK_LATENCY_MS = Number(import.meta.env.VITE_MOCK_LATENCY_MS ?? 450);
const TIMEOUT_MS = 20_000;

/** Every failure the UI sees is an ApiError carrying a readable message and a next action. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly hint: string;
  constructor(status: number, code: ErrorCode, message: string, hint: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.hint = hint;
  }
}

function isErrorBody(x: unknown): x is ErrorBody {
  return typeof x === "object" && x !== null && "error" in x && typeof (x as ErrorBody).error?.message === "string";
}

let mock: Promise<MockBackend> | null = null;
function mockBackend(): Promise<MockBackend> {
  // Lazy import keeps the mock engine (and Net3 data) out of the bundle path when unused.
  mock ??= import("../mock/engine").then((m) => new m.MockBackend(Number(import.meta.env.VITE_MOCK_SIGNATURES_MS ?? 0)));
  return mock;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

async function request<T>(method: "GET" | "POST", path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  if (USE_MOCKS) {
    const backend = await mockBackend();
    // Jittered latency so spinners and disabled states are visible in the demo.
    await sleep(MOCK_LATENCY_MS * (0.6 + 0.8 * Math.random()), signal);
    const res = backend.handle(method, path, body);
    // Round-trip through JSON so mock responses are exactly what fetch would deliver.
    const payload = JSON.parse(JSON.stringify(res.body));
    if (res.status >= 400) throw toApiError(res.status, payload);
    return payload as T;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  signal?.addEventListener("abort", () => ctrl.abort());
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    if (!res.ok) throw toApiError(res.status, payload);
    return payload as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (signal?.aborted) throw e;
    const timedOut = ctrl.signal.aborted;
    throw new ApiError(
      0,
      "network_error",
      timedOut ? `The backend did not answer within ${TIMEOUT_MS / 1000} s.` : `Cannot reach the backend at ${API_URL}.`,
      "Start the backend (uvicorn backend.main:app --port 8000) or set VITE_USE_MOCKS=true.",
    );
  } finally {
    clearTimeout(timer);
  }
}

function toApiError(status: number, payload: unknown): ApiError {
  if (isErrorBody(payload)) return new ApiError(status, payload.error.code, payload.error.message, payload.error.hint);
  // FastAPI's default 422 shape ({detail:[...]}) or anything else unexpected.
  const detail = (payload as { detail?: unknown } | null)?.detail;
  return new ApiError(
    status,
    status === 422 ? "validation_error" : status === 404 ? "scenario_not_found" : "internal_error",
    typeof detail === "string" ? detail : `Request failed with HTTP ${status}.`,
    status === 404 ? "Simulate again." : "Try again; if it persists, check the backend logs.",
  );
}

export const api = {
  health: (s?: AbortSignal) => request<HealthResponse>("GET", "/health", undefined, s),
  network: (s?: AbortSignal) => request<NetworkResponse>("GET", "/network", undefined, s),
  leak: (b: ScenarioRequest, s?: AbortSignal) => request<ScenarioResponse>("POST", "/scenario/leak", b, s),
  detect: (scenario_id: string, s?: AbortSignal) => request<DetectResponse>("POST", "/detect", { scenario_id }, s),
  agentStep: (b: AgentStepRequest, s?: AbortSignal) => request<AgentStepResponse>("POST", "/agent/step", b, s),
  fieldResult: (b: FieldResultRequest, s?: AbortSignal) => request<FieldResultResponse>("POST", "/field/result", b, s),
  inspect: (b: InspectRequest, s?: AbortSignal) => request<InspectResponse>("POST", "/field/inspect", b, s),
  reveal: (id: string, s?: AbortSignal) => request<RevealResponse>("GET", `/scenario/${encodeURIComponent(id)}/reveal`, undefined, s),
  eval: (s?: AbortSignal) => request<EvalResponse>("GET", "/eval", undefined, s),
  placeSensors: (b: SensorPlaceRequest, s?: AbortSignal) => request<SensorPlaceResponse>("POST", "/sensors/place", b, s),
  optimizeRepair: (b: RepairRequest, s?: AbortSignal) => request<RepairResponse>("POST", "/repair/optimize", b, s),
};
