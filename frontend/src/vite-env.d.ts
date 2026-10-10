/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "false" talks to the real backend; anything else uses the in-browser mock engine. */
  readonly VITE_USE_MOCKS?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_MOCK_LATENCY_MS?: string;
  /** Simulates the backend's signature build on startup (ms) to exercise the progress banner. */
  readonly VITE_MOCK_SIGNATURES_MS?: string;
  /** JSON array of demo presets [{id,label,story,seed,size,noise,k}] verified on the target backend. */
  readonly VITE_DEMO_SEEDS?: string;
  /** "cytoscape" forces the fallback map engine; default is deck.gl (when WebGL is available). */
  readonly VITE_MAP_ENGINE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
