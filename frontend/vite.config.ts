import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";

// Standalone Vite config for self-hosted / Docker builds.
//
// The project originally used Lovable's proprietary
// `@lovable.dev/vite-tanstack-config` wrapper, which pulls packages from a
// private, auth-gated registry (europe-west1-npm.pkg.dev) only reachable
// from inside Lovable's own sandbox. That wrapper also defaults the nitro
// build target to "cloudflare" (a Workers bundle), which isn't runnable in
// a plain Docker/Node container. This file replaces it with the equivalent
// public-package configuration, targeting Node instead of Cloudflare, so
// `bun run build` / `npm run build` produce a server ProxyForge's container
// can actually run with `node .output/server/index.mjs`.
export default defineConfig({
  server: {
    port: 8080,
  },
  plugins: [
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tailwindcss(),
    tanstackStart({
      target: "node-server",
    }),
    viteReact(),
  ],
});
