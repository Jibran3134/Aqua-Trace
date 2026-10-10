import { animate } from "motion/react";
import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "./motion";

/** Counts toward `value` (plan W6 number tickers). Renders text directly to avoid per-frame React work. */
export function AnimatedNumber({ value, format = (v) => String(Math.round(v)), duration = 0.8, className }: { value: number; format?: (v: number) => string; duration?: number; className?: string }) {
  const el = useRef<HTMLSpanElement>(null);
  const from = useRef(value);
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    if (prefersReducedMotion()) {
      node.textContent = format(value);
      from.current = value;
      return;
    }
    const controls = animate(from.current, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        node.textContent = format(v);
        from.current = v;
      },
    });
    return () => controls.stop();
  }, [value, format, duration]);
  return (
    <span ref={el} className={className}>
      {format(value)}
    </span>
  );
}
