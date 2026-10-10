// Synthesized sound cues (plan W6): off by default, M toggles. No audio files, so nothing to
// license and nothing to download; everything is a few oscillators through the Web Audio API.

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, start: number, dur: number, type: OscillatorType, gain: number, glideTo?: number) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + start;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

export const cues = {
  /** Detect: a soft sonar ping with a faint echo. */
  ping: () => {
    tone(1180, 0, 0.5, "sine", 0.12, 980);
    tone(1180, 0.32, 0.45, "sine", 0.04, 980);
  },
  /** Crew found nothing: a low, short thud. */
  thud: () => tone(140, 0, 0.28, "triangle", 0.18, 70),
  /** Leak found: a bright two-note chime. */
  found: () => {
    tone(784, 0, 0.35, "sine", 0.12);
    tone(1175, 0.12, 0.55, "sine", 0.1);
  },
  /** Reveal: a rising shimmer. */
  reveal: () => {
    tone(523, 0, 0.6, "sine", 0.07, 1046);
    tone(659, 0.08, 0.6, "sine", 0.05, 1318);
  },
};
