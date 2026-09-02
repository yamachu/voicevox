import { createRequire } from "node:module";
import { copyFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { defaultClientConditions, defineConfig, type Plugin } from "vite";
import dotnetWasm from "@yamachu/vite-plugin-dotnet-wasm";
import wasm from "vite-plugin-wasm";

const __dirname = import.meta.dirname;

const require = createRequire(import.meta.url);
const ortDistDir = dirname(require.resolve("onnxruntime-web"));

/**
 * 非 bundle 版 onnxruntime-web が実行時に読み込むファイル
 *
 * ort.min.mjs が読む glue は "ort-wasm-simd-threaded.jsep.mjs" 固定で、
 * wasm EP へのフォールバックもこの jsep ビルドに含まれる。
 * 非 jsep 版はどこからも参照されないためコピーしない。
 */
const ortRuntimeFiles = [
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
];

function copyOnnxRuntimeAssets(): Plugin {
  return {
    name: "copy-onnxruntime-assets",
    async writeBundle(options) {
      const outDir = options.dir;
      if (outDir == undefined) {
        this.error("Could not determine output directory for ONNX Runtime assets");
      }
      await Promise.all(
        ortRuntimeFiles.map((fileName) =>
          copyFile(join(ortDistDir, fileName), join(outDir, fileName))
        )
      );
    },
  };
}

export default defineConfig({
  // https://github.com/microsoft/onnxruntime/issues/19556#issuecomment-2681823775
  assetsInclude: ["**/*.onnx"],
  optimizeDeps: {
    exclude: ["onnxruntime-web"],
  },
  resolve: {
    // onnxruntime-web の既定 export は wasm を 30MB の data URI として
    // 2箇所に埋め込む bundle 版を指し、61MB の単一行が DevTools を固める。
    // wasm を外部ファイルとして読む非 bundle 版を選ぶ
    conditions: ["onnxruntime-web-use-extern-wasm", ...defaultClientConditions],
  },
  plugins: [
    dotnetWasm({
      projectPath: "VoicevoxEngineSharp/src/WasmWeb/src/WasmWeb.csproj",
      configuration: "Debug",
    }),
    wasm(),
    copyOnnxRuntimeAssets(),
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
