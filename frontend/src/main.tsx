import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <Toaster
      theme="dark"
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: "!bg-ink-850 !border-ink-600 !text-limestone !rounded-2xl !font-sans",
          description: "!text-silt",
        },
      }}
    />
  </StrictMode>,
);
