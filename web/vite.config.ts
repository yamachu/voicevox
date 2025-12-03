import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "../public",
    target: "esnext",
    lib: {
      name: "sw",
      entry: "src/index.ts",
      formats: ["iife"],
      fileName: () => `sw.js`,
    },
  },
});
