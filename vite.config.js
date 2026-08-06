import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { publicOverlay } from "./scripts/public-overlay.js";

// Standard Vite + React config. The dev server transpiles JSX ahead of time
// (no more in-browser Babel) and `vite build` emits a minified, hashed,
// tree-shaken production bundle into dist/.
//
// public-panel/ carries the Control Panel's own PWA half — manifest, service worker, icons and
// launch images — laid over the shared public/ (see scripts/public-overlay.js).
export default defineConfig({
  plugins: [
    react(),
    publicOverlay(fileURLToPath(new URL("./public-panel", import.meta.url))),
  ],
  server: { port: 5173, open: true },
  build: { outDir: "dist", sourcemap: true },
});
