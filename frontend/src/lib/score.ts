// One score -> color mapping for the whole UI (canvas fills, bars, legend). Keep in sync with
// .score-ramp in index.css.
const STOPS: [number, [number, number, number]][] = [
  [0, [59, 91, 87]], // #3b5b57 cold slate-verdigris: "no evidence"
  [0.35, [154, 154, 74]], // olive transition
  [0.6, [242, 179, 61]], // #f2b33d saffron
  [1, [255, 90, 54]], // #ff5a36 vermilion
];

/** t in [0,1] -> hex color along the leak-heat ramp. */
export function rampColor(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < STOPS.length; i++) {
    const [p1, c1] = STOPS[i];
    const [p0, c0] = STOPS[i - 1];
    if (x <= p1) {
      const f = (x - p0) / (p1 - p0);
      const c = c0.map((v, k) => Math.round(v + (c1[k] - v) * f));
      return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    }
  }
  return "#ff5a36";
}

/** Scores are relative and small in absolute terms; display relative to the current leader. */
export function normalizeToTop(score: number, top: number): number {
  return top > 0 ? score / top : 0;
}

export const fmtScore = (s: number) => s.toFixed(3);
export const fmtPct = (r: number) => `${Math.round(r * 100)}%`;
