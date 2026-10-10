// 1:1 mirror of contracts/api.md (v1.1). If you change one, change both and log it in the changelog.

export type NodeId = string;
export type PipeId = string;

export type NodeType = "junction" | "reservoir" | "tank";
export type LinkKind = "pipe" | "pump" | "valve";
export type LeakSize = "small" | "medium" | "large";
export type NoiseLevel = "low" | "mid" | "high";
export type DetectStatus = "ok" | "insufficient_evidence";
export type AgentMode = "auto" | "scripted" | "llm";
export type AgentSource = "llm" | "scripted";
export type InvestigationState = "investigating" | "resolved" | "abstained";
export type AgentEventType = "thought" | "tool_call" | "tool_result" | "recommendation" | "abstain" | "final";
export type ToolName =
  | "rank_candidates"
  | "simulate_hypothesis"
  | "plan_inspection"
  | "record_field_result"
  | "recommend_sensor_addition";

// ---------- errors ----------
export type ErrorCode =
  | "scenario_not_found"
  | "eval_missing"
  | "validation_error"
  | "signatures_not_ready"
  | "internal_error"
  | "network_error" // client-side only: fetch failed / backend unreachable
  | "not_implemented" // client-side only: route not mounted on the backend yet
  // emitted by backend/app: see DomainError call sites
  | "not_ready"
  | "rate_limit_exceeded"
  | "rate_limit_unavailable"
  | "database_unavailable"
  | "scenario_conflict"
  | "insufficient_evidence"
  | "http_error"
  // `invalid_node`, `invalid_seed`, `invalid_sensors`, ... are all 422s; accept any
  // new backend code without a type error rather than silently mislabelling it.
  | (string & {});

export interface ErrorBody {
  error: { code: ErrorCode; message: string; hint: string };
}

// ---------- GET /health ----------
export interface HealthResponse {
  /** The backend reports "degraded" when PostgreSQL or Redis is unreachable. */
  status: "ok" | "degraded";
  signatures_ready: boolean;
  /** Normalized from the backend's `signatures_progress`. */
  progress?: number;
  database?: "ok" | "unavailable";
  redis?: "ok" | "unavailable";
}

// ---------- GET /network ----------
export interface NetNode {
  id: NodeId;
  x: number;
  y: number;
  type: NodeType;
}
export interface NetPipe {
  id: PipeId;
  from: NodeId;
  to: NodeId;
  length: number;
  kind?: LinkKind;
}
export interface NetworkResponse {
  nodes: NetNode[];
  pipes: NetPipe[];
  default_sensors: NodeId[];
}

// ---------- POST /scenario/leak ----------
export interface ScenarioRequest {
  seed?: number;
  size?: LeakSize;
  noise?: NoiseLevel;
  sensors?: NodeId[];
  k?: number;
}
export interface ScenarioResponse {
  scenario_id: string;
  seed?: number;
  sensors: NodeId[];
  readings: Record<NodeId, number | null>;
  meta: {
    time_step: "t0";
    noise_sigma: number;
    noise_level?: NoiseLevel;
    demand_mult_known: false;
  };
}

// ---------- POST /detect ----------
export interface Candidate {
  node: NodeId;
  score: number;
  adjacent_pipes: PipeId[];
  est_leak_lps: number;
  tie_group?: number | null;
}
export interface Evidence {
  residual_norm: number;
  noise_floor: number;
  margin_top1_vs_top2: number;
  live_sensors?: number;
}
export interface DetectResponse {
  status: DetectStatus;
  candidates: Candidate[];
  evidence: Evidence;
  note?: string | null;
  recommended_sensor?: NodeId | null;
}

// ---------- POST /agent/step ----------
export interface AgentEvent {
  step: number;
  type: AgentEventType;
  name?: ToolName;
  args?: Record<string, unknown>;
  result?: unknown;
  text?: string;
}
export interface AgentStepRequest {
  scenario_id: string;
  mode?: AgentMode;
}
export interface AgentStepResponse {
  events: AgentEvent[];
  source: AgentSource;
  recommended_node?: NodeId | null;
  route?: NodeId[];
  route_length_m?: number;
  inspections_used?: number;
  state: InvestigationState;
}

// ---------- POST /field/result ----------
export interface FieldResultRequest {
  scenario_id: string;
  node: NodeId;
  found: boolean;
}
export interface FieldResultResponse {
  state: "investigating" | "resolved";
  ranking: { node: NodeId; score: number }[];
  note?: string | null;
}

// ---------- POST /field/inspect (v1.1: simulated crew) ----------
export interface InspectRequest {
  scenario_id: string;
  node: NodeId;
}
export interface InspectResponse extends FieldResultResponse {
  node: NodeId;
  found: boolean;
}

// ---------- GET /scenario/{id}/reveal ----------
export interface RevealResponse {
  true_leak_node: NodeId;
  true_size: LeakSize;
  rank_of_truth: number;
  hop_error_top1: number;
}

// ---------- GET /eval ----------
export interface Metrics {
  n: number;
  top1: number;
  top3: number;
  mean_hop_error: number;
  insufficient: number;
  skipped: number;
  baseline_top3?: number;
}
export interface EvalResponse {
  meta: {
    seeds: number;
    k: number;
    tau: number;
    time_step: string;
    network: string;
    note: string;
    generated_at?: string;
  };
  results: Metrics;
  baseline: Metrics;
  by_noise: Record<NoiseLevel, Metrics>;
  by_size: Record<LeakSize, Metrics>;
  by_k: Record<string, Metrics>;
  gate?: { no_leak_flagged: number; small_leak_flagged: number };
}

// ---------- POST /sensors/place (S1) ----------
export interface SensorPlaceRequest {
  k: number;
  noise?: NoiseLevel;
}
export interface CurvePoint {
  k: number;
  top1: number;
  top3: number;
  baseline_top3?: number;
}
export interface SensorPlaceResponse {
  sensors: NodeId[];
  curve: CurvePoint[];
}

// ---------- POST /repair/optimize (S2 + S3) ----------
export interface RepairCandidate {
  node: NodeId;
  est_leak_lps: number;
  repair_cost_pkr?: number;
}
export interface RepairRequest {
  budget_pkr: number;
  value_per_litre_pkr?: number;
  candidates: RepairCandidate[];
}
export interface RepairSelection {
  node: NodeId;
  est_leak_lps: number;
  repair_cost_pkr: number;
  litres_per_day: number;
  cost_defaulted: boolean;
}
export interface RepairResponse {
  selected: RepairSelection[];
  total_cost_pkr: number;
  litres_per_day_saved: number;
  value_pkr_per_day: number;
  payback_days: number | null;
  greedy: { selected: NodeId[]; total_cost_pkr: number; litres_per_day_saved: number };
  assumptions: { value_per_litre_pkr: number; default_repair_cost_pkr: number; label: string };
  note: string;
}
