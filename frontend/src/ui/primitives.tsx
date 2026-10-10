import clsx from "clsx";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

export const cn = clsx;

// ---------- Button ----------
type Tone = "primary" | "danger" | "tracer" | "ghost" | "quiet";

const TONES: Record<Tone, string> = {
  primary:
    "bg-verdigris text-ink-950 hover:bg-verdigris-bright shadow-[0_8px_24px_-10px_rgb(63_191_166/0.8)] disabled:bg-ink-600 disabled:text-silt disabled:shadow-none",
  danger:
    "bg-vermilion text-ink-950 hover:brightness-110 shadow-[0_8px_24px_-10px_rgb(255_90_54/0.8)] disabled:bg-ink-600 disabled:text-silt disabled:shadow-none",
  tracer:
    "bg-tracer/15 text-tracer ring-1 ring-tracer/50 hover:bg-tracer/25 disabled:bg-transparent disabled:text-silt-dim disabled:ring-ink-600",
  ghost: "bg-ink-800 text-limestone ring-1 ring-ink-600 hover:bg-ink-700 hover:ring-ink-500 disabled:text-silt-dim",
  quiet: "text-silt hover:text-limestone hover:bg-ink-800 disabled:text-silt-dim",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: Tone;
  loading?: boolean;
  icon?: ReactNode;
  size?: "md" | "lg" | "sm";
}

export function Button({ tone = "ghost", loading, icon, size = "md", className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold tracking-tight transition-all duration-200",
        "active:translate-y-px disabled:cursor-not-allowed",
        size === "lg" && "h-12 px-5 text-[1rem]",
        size === "md" && "h-10 px-4 text-[0.92rem]",
        size === "sm" && "h-8 px-3 text-[0.8rem]",
        TONES[tone],
        className,
      )}
    >
      {loading ? <Spinner className="size-4" /> : icon}
      {children}
    </button>
  );
}

// ---------- Badge ----------
type BadgeTone = "verdigris" | "saffron" | "vermilion" | "tracer" | "phosphor" | "neutral";
const BADGE: Record<BadgeTone, string> = {
  verdigris: "bg-verdigris/12 text-verdigris-bright ring-verdigris/35",
  saffron: "bg-saffron/12 text-saffron ring-saffron/35",
  vermilion: "bg-vermilion/12 text-vermilion ring-vermilion/40",
  tracer: "bg-tracer/12 text-tracer ring-tracer/40",
  phosphor: "bg-phosphor/10 text-phosphor ring-phosphor/35",
  neutral: "bg-ink-800 text-silt ring-ink-600",
};

export function Badge({ tone = "neutral", className, children, dot }: { tone?: BadgeTone; className?: string; children: ReactNode; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[0.72rem] font-semibold ring-1", BADGE[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

// ---------- Provenance: every user-facing number is labeled ----------
export type Provenance = "measured" | "simulated" | "assumed" | "relative score" | "simulated reading" | "simulated estimate";

export function Prov({ kind, className }: { kind: Provenance; className?: string }) {
  const tone = kind === "assumed" ? "text-saffron/90" : kind === "relative score" ? "text-verdigris-bright/80" : "text-silt";
  return <span className={cn("mx-0.5 inline-block whitespace-nowrap font-mono text-[0.62rem] uppercase tracking-[0.12em]", tone, className)}>{kind}</span>;
}

// ---------- Panel ----------
export function Panel({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={cn(
        "relative rounded-2xl border border-ink-600/70 bg-gradient-to-b from-ink-850/95 to-ink-900/95 shadow-lift backdrop-blur-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("font-mono text-[0.68rem] uppercase tracking-[0.18em] text-silt", className)}>{children}</div>;
}

// ---------- Spinner: a pressure ripple, not a generic wheel ----------
export function Spinner({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-block size-5", className)} role="status" aria-label="Loading">
      <span className="absolute inset-0 rounded-full border-2 border-current opacity-25" />
      <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-current" />
    </span>
  );
}

export function RippleDot({ color = "var(--color-vermilion)", className }: { color?: string; className?: string }) {
  return (
    <span className={cn("relative inline-flex size-3", className)}>
      <span className="absolute inset-0 animate-ripple rounded-full" style={{ background: color }} />
      <span className="relative inline-flex size-3 rounded-full" style={{ background: color }} />
    </span>
  );
}

// ---------- Brand mark: a drop whose interior is a pipe graph with one hot node ----------
export function AquaTraceMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <defs>
        <linearGradient id="at-drop" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6fe0c7" />
          <stop offset="1" stopColor="#1f7f70" />
        </linearGradient>
      </defs>
      <path d="M20 3C20 3 7 17.5 7 25.5a13 13 0 0 0 26 0C33 17.5 20 3 20 3Z" fill="none" stroke="url(#at-drop)" strokeWidth="2.4" strokeLinejoin="round" />
      <g stroke="#3fbfa6" strokeWidth="1.6" strokeLinecap="round">
        <path d="M14 25h7l5-5M21 25l3 5M14 25l-1 4" />
      </g>
      <circle cx="14" cy="25" r="1.9" fill="#e8e2d0" />
      <circle cx="21" cy="25" r="1.9" fill="#e8e2d0" />
      <circle cx="24" cy="30" r="1.9" fill="#e8e2d0" />
      <circle cx="26" cy="20" r="2.6" fill="#ff5a36" />
    </svg>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-ink-600 bg-ink-800 px-1.5 py-0.5 font-mono text-[0.7rem] text-silt">{children}</kbd>;
}
