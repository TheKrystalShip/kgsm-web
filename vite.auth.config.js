import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// The auth anchor's own pages — a THIRD target over the same source tree, shipped as kgsm-web-auth.
//
// Built under `base: "/ui/"`, because the anchor serves every asset of it there and nothing else of
// its origin belongs to this bundle. Three documents, one per page, each carrying its own floor: the
// anchor serves the one a request calls for, and they share one application that replaces the floor
// on mount.
//
// It reuses the panel's sign-in card and settings furniture and may not reach the panel's data layer
// (`npm run check:auth`). It gets only the shared public/ floor — fonts and the brand mark — because
// it installs as nothing: no manifest, no service worker, no icons of its own.
export default defineConfig({
  base: "/ui/",
  plugins: [react()],
  server: { port: 5175 },
  build: {
    outDir: "dist-auth",
    sourcemap: true,
    rollupOptions: {
      input: {
        "auth-sign-in": fileURLToPath(new URL("./auth-sign-in.html", import.meta.url)),
        "auth-wait": fileURLToPath(new URL("./auth-wait.html", import.meta.url)),
        "auth-account": fileURLToPath(new URL("./auth-account.html", import.meta.url)),
      },
    },
  },
});
