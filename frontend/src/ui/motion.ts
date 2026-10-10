// One motion language for the whole app (plan W6). Components import these instead of inventing
// their own durations, so every step reads as the same choreography.

export const dur = {
  micro: 0.12,
  ui: 0.24,
  scene: 0.8,
  hero: 1.6,
} as const;

/** Milliseconds, for deck.gl transitions and timers. */
export const ms = {
  micro: 120,
  ui: 240,
  scene: 800,
  hero: 1600,
  stagger: 120,
} as const;

export const ease = {
  out: [0.16, 1, 0.3, 1] as [number, number, number, number],
  inOut: [0.65, 0, 0.35, 1] as [number, number, number, number],
};

export const spring = {
  ui: { type: "spring" as const, stiffness: 320, damping: 30 },
  soft: { type: "spring" as const, stiffness: 160, damping: 20 },
};

export const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}
