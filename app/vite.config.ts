import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

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
      "/api": "http://localhost:3000",
      "/data": "http://localhost:3000",
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
