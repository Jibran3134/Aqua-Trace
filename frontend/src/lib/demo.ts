import type { LeakSize, NoiseLevel } from "../contracts/types";

export interface DemoPreset {
  id: string;
  label: string;
  story: string;
  seed: number;
  size: LeakSize;
  noise: NoiseLevel;
  k: number;
}

/**
 * Verified against the MOCK engine. Seeds behave differently on the real backend, so once it is up,
 * re-verify and override with VITE_DEMO_SEEDS (same JSON shape) without touching code.
 */
const MOCK_VERIFIED: DemoPreset[] = [
  { id: "A", label: "Demo A", story: "Crew misses once, re-rank finds it", seed: 897, size: "medium", noise: "mid", k: 6 },
  { id: "B", label: "Demo B", story: "Honest no-call, add a sensor, then #1", seed: 101, size: "small", noise: "high", k: 6 },
];

function fromEnv(): DemoPreset[] | null {
  const raw = import.meta.env.VITE_DEMO_SEEDS;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((p) => typeof p.seed === "number" && p.id && p.label) ? parsed : null;
  } catch {
    console.warn("[AquaTrace] VITE_DEMO_SEEDS is not valid JSON; using built-in demo seeds.");
    return null;
  }
}

export const DEMO_PRESETS: DemoPreset[] = fromEnv() ?? MOCK_VERIFIED;
