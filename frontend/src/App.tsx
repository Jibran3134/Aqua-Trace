import { useEffect, useState } from "react";
import { ConsolePage } from "./pages/ConsolePage";
import { FoundationPage } from "./pages/FoundationPage";

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
  if (hash === "#/design") return <FoundationPage />;
  return <ConsolePage />;
}
