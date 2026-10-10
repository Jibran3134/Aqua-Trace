import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { IntroPage } from "./pages/IntroPage";

// The intro paints first; the console (Cytoscape, motion, mock engine) streams in behind it.
const ConsolePage = lazy(() => import("./pages/ConsolePage").then((m) => ({ default: m.ConsolePage })));
const FoundationPage = lazy(() => import("./pages/FoundationPage").then((m) => ({ default: m.FoundationPage })));
// Warm the console chunk while the intro is on screen so "Enter" is instant.
const preloadConsole = () => void import("./pages/ConsolePage");

/** Hash routing keeps the app a single static bundle (no server rewrites needed for the demo). */
function useHash() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

export default function App() {
  const hash = useHash();
  const enter = useCallback(() => {
    window.location.hash = "#/console";
  }, []);
  useEffect(preloadConsole, []);
  // The intro is the front door; the console lives at #/console so a reload keeps you there.
  if (hash === "" || hash === "#" || hash === "#/" || hash === "#/intro") return <IntroPage onEnter={enter} />;
  return <Suspense fallback={<div className="h-full bg-ink-950" />}>{hash === "#/design" ? <FoundationPage /> : <ConsolePage />}</Suspense>;
}
