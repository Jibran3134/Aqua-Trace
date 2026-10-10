// Theme tokens for code that cannot read CSS variables (deck.gl layers, SVG attributes, canvas).
// Keep in sync with the :root / [data-theme="projector"] blocks in index.css.

export type ThemeName = "dark" | "projector";

export interface Palette {
  bg: string;
  panel: string;
  text: string;
  textDim: string;
  muted: string;
  grid: string;
  pipe: string;
  pipeGlow: string;
  junction: string;
  sensor: string;
  truth: string;
  route: string;
  /** Leak-heat ramp stops: weak evidence -> leading candidate. */
  ramp: [number, [number, number, number]][];
  /** Validated categorical pair for method-vs-baseline charts (dataviz validator, per surface). */
  chartMethod: string;
  chartBaseline: string;
}

export const PALETTES: Record<ThemeName, Palette> = {
  dark: {
    bg: "#071316",
    panel: "#0c1f23",
    text: "#e8e2d0",
    textDim: "#bdb6a3",
    muted: "#8fa6a0",
    grid: "#24433f",
    pipe: "#3fbfa6",
    pipeGlow: "#1f7f70",
    junction: "#6f9a92",
    sensor: "#d4f26a",
    truth: "#b48cff",
    route: "#6fe0c7",
    ramp: [
      [0, [59, 91, 87]],
      [0.35, [154, 154, 74]],
      [0.6, [242, 179, 61]],
      [1, [255, 90, 54]],
    ],
    // dark surface #0C1F23: protan dE 6.6 -> baseline hatched + direct labels (secondary encoding)
    chartMethod: "#2A9C86",
    chartBaseline: "#C2785F",
  },
  projector: {
    bg: "#f3eee3",
    panel: "#ece5d6",
    text: "#1b2340",
    textDim: "#3a4466",
    muted: "#5a6380",
    grid: "#d6cdb8",
    pipe: "#2f6f68",
    pipeGlow: "#7fb3aa",
    junction: "#5f7f7a",
    sensor: "#2f7d4f",
    truth: "#5b3fd6",
    route: "#00735f",
    ramp: [
      [0, [157, 178, 173]],
      [0.35, [196, 176, 96]],
      [0.6, [233, 162, 59]],
      [1, [196, 69, 43]],
    ],
    // light surface #F3EEE3: all checks pass (deutan dE 10.4)
    chartMethod: "#008C74",
    chartBaseline: "#C25530",
  },
};

export function currentTheme(): ThemeName {
  return document.documentElement.dataset.theme === "projector" ? "projector" : "dark";
}

export function palette(theme: ThemeName = currentTheme()): Palette {
  return PALETTES[theme];
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
