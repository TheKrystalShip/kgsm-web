import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Standard Vite + React config. The dev server transpiles JSX ahead of time
// (no more in-browser Babel) and `vite build` emits a minified, hashed,
// tree-shaken production bundle into dist/.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, open: true },
  build: { outDir: "dist", sourcemap: true },
});
