// One score -> color mapping for the whole UI (map fills, bars, legend). Stops live in ui/tokens.ts
// per theme; keep in sync with .score-ramp in index.css.
import { palette } from "../ui/tokens";

/** t in [0,1] -> [r,g,b] along the current theme's leak-heat ramp. */
export function rampRgb(t: number): [number, number, number] {
  const STOPS = palette().ramp;
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < STOPS.length; i++) {
    const [p1, c1] = STOPS[i];
    const [p0, c0] = STOPS[i - 1];
    if (x <= p1) {
      const f = (x - p0) / (p1 - p0);
      return c0.map((v, k) => Math.round(v + (c1[k] - v) * f)) as [number, number, number];
    }
  }
  return STOPS[STOPS.length - 1][1];
}

/** t in [0,1] -> hex color along the leak-heat ramp. */
export function rampColor(t: number): string {
  return `#${rampRgb(t).map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Scores are relative and small in absolute terms; display relative to the current leader. */
export function normalizeToTop(score: number, top: number): number {
  return top > 0 ? score / top : 0;
}

export const fmtScore = (s: number) => s.toFixed(3);
export const fmtPct = (r: number) => `${Math.round(r * 100)}%`;
