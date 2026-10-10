import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // The backend allows CORS for exactly this origin, so keep the port fixed.
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
});
