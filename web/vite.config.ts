import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  // https://github.com/microsoft/onnxruntime/issues/19556#issuecomment-2681823775
  assetsInclude: ["**/*.onnx"],
  optimizeDeps: {
    exclude: ["onnxruntime-web"],
  },
  plugins: [wasm()],
  build: {
    outDir: "../public",
    target: "esnext",
    lib: {
      name: "sw",
      entry: "src/index.ts",
      fileName: () => `sw.js`,
    },
    rollupOptions: {
      // DO NOT bundle dotnet runtime files
      external: [/^\.\/_framework\//],
      output: {
        paths: (id) => {
          // Keep _framework paths as-is in build output
          if (id.startsWith("./_framework/")) {
            return id;
          }
          return id;
        },
      },
      makeAbsoluteExternalsRelative: false,
    },
  },
});
