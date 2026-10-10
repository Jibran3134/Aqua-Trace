import type { NodeId } from "../contracts/types";
import type { Fit } from "./detector";
import type { SimulatedScenario } from "./physics";

/** Per-scenario server-side state (the backend's in-memory SCENARIOS dict, mock edition). */
export interface ScenarioState {
  id: string;
  sim: SimulatedScenario; // holds the truth: never serialize into leak/detect/agent responses
  sensors: NodeId[];
  readings: Record<NodeId, number | null>;
  live: NodeId[];
  residual: number[];
  fits: Map<NodeId, Fit>;
  likelihood: Map<NodeId, number>;
  weights: Map<NodeId, number>;
  inspected: Set<NodeId>;
  inspectionOrder: NodeId[];
  resolved: boolean;
  abstained: boolean;
  foundAt: NodeId | null;
  turns: number;
  createdAt: number;
}
