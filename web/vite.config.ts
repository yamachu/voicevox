import { resolve } from "node:path";
import { defineConfig } from "vite";
import dotnetWasm from "@yamachu/vite-plugin-dotnet-wasm";
import wasm from "vite-plugin-wasm";

const __dirname = import.meta.dirname;

export default defineConfig({
  // https://github.com/microsoft/onnxruntime/issues/19556#issuecomment-2681823775
  assetsInclude: ["**/*.onnx"],
  optimizeDeps: {
    exclude: ["onnxruntime-web"],
  },
  plugins: [
    dotnetWasm({
      projectPath: "VoicevoxEngineSharp/src/WasmWeb/src/WasmWeb.csproj",
      configuration: "Debug",
    }),
    wasm(),
  ],
  build: {
    outDir: "../public",
    assetsDir: "",
    target: "esnext",
    lib: {
      entry: {
        sw: resolve(__dirname, "src/sw.ts"),
        "sw-proxy": resolve(__dirname, "src/sw-proxy.ts"),
        "engine-worker": resolve(__dirname, "src/engine-worker.ts"),
      },
      formats: ["es"],
      fileName: (format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      output: {
        // 複数エントリで共有されるモジュールは分割されるため、
        // public/ に古いハッシュ付きファイルが残らないよう固定名にする
        chunkFileNames: "[name].js",
      },
    },
  },
});
