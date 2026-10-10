import { useEffect, useState } from "react";
import { useStore } from "../../state/store";

/**
 * "While you search" (plan W7): estimated litres lost since detection, at the leading candidate's
 * simulated flow, in real time; frozen when the crew confirms. Rs uses the Repairs-tab assumption.
 */
export function useLoss() {
  const detectedAt = useStore((s) => s.detectedAt);
  const resolvedAt = useStore((s) => s.resolvedAt);
  const lps = useStore((s) => s.initialDetection?.status === "ok" ? (s.initialDetection.candidates[0]?.est_leak_lps ?? 0) : 0);
  const vpl = useStore((s) => s.valuePerLitre);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!detectedAt || resolvedAt) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [detectedAt, resolvedAt]);
  if (!detectedAt || lps <= 0) return null;
  const seconds = Math.max(0, ((resolvedAt ?? now) - detectedAt) / 1000);
  const litres = lps * seconds;
  return { litres, rupees: litres * vpl, lps, frozen: !!resolvedAt };
}

export function LossTicker({ big = false }: { big?: boolean }) {
  const loss = useLoss();
  if (!loss) return null;
  return (
    <div className={big ? "" : "text-right leading-tight"} title="Simulated estimate at the leading candidate's flow, real time since detection; Rs/L is an assumption">
      <div className={`num font-bold ${big ? "text-[1.5rem]" : "text-[0.95rem]"} ${loss.frozen ? "text-limestone" : "text-vermilion"}`}>
        {Math.round(loss.litres).toLocaleString()} L
      </div>
      <div className="text-[0.8rem] text-silt">
        {loss.frozen ? "lost before the find" : "lost while searching"} · ≈Rs {Math.round(loss.rupees).toLocaleString()}
      </div>
    </div>
  );
}
