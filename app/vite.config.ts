import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

const apiTarget = process.env.VITE_API_TARGET ?? "http://localhost:3000";
const proxyOpts = { target: apiTarget, changeOrigin: true, secure: true };

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      globals: { Buffer: true, global: true, process: true },
      protocolImports: true,
    }),
  ],
  // The FHE worker runs as a module worker (vite-plugin-node-polyfills injects
  // ESM `import` statements; classic workers can't load those). worker.format
  // tells Vite to bundle workers as ESM in production too.
  worker: {
    format: "es",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname, ".."), path.resolve(__dirname)],
    },
    proxy: {
      "/api": proxyOpts,
      "/data": proxyOpts,
    },
  },
  optimizeDeps: {
    exclude: [
      "@noir-lang/noir_js",
      "@noir-lang/acvm_js",
      "@noir-lang/noirc_abi",
      "@aztec/bb.js",
    ],
    include: ["pino"],
  },
});
