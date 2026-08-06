import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// The standalone assistant's build — a SECOND target over the same source tree.
//
// A separate config rather than a second input on the panel's build, so each bundle carries only
// its own entry and each deploy ships only what that host serves: the panel's wwwroot has no
// assistant page in it, and the leaf's has no control panel. The shared chat (src/chat/) is
// compiled into both from one source, which is the whole point — a divergence between the dock and
// this surface would be a bug, not a variant.
//
// It emits assistant.html; the leaf serves the directory and its index, so the served page is
// renamed to index.html on deploy (deploy/deploy-assistant.sh).
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, open: "/assistant.html" },
  build: {
    outDir: "dist-assistant",
    sourcemap: true,
    rollupOptions: {
      input: fileURLToPath(new URL("./assistant.html", import.meta.url)),
    },
  },
});
