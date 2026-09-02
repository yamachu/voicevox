/**
 * ENGINE 処理を担う DedicatedWorker
 *
 * .NET Wasm Runtime / OpenJTalk 辞書 / ONNX Runtime のすべてをこのワーカーが所有する。
 * .NET から呼ばれる推論も同じワーカー内で完結するため、スレッドを跨ぐ往復は発生しない。
 *
 * .NET 10 のローダーは Web Worker 上で読み込まれると自動的に sidecar モード
 * （= emscripten main を worker 上で動かすモード）に入るため、
 * ここで dotnet.create() を呼ぶのは想定された構成である。
 */
/// <reference lib="webworker" />

import {
  getTransferableBuffer,
  isEngineRequest,
  normalizeAssetBaseUrl,
} from "./EngineWorkerProtocol.js";
import { InferenceEngine } from "./InferenceEngine.js";
import { WasmEngine } from "./WasmEngine.js";
import type {
  EngineRequest,
  EngineResponse,
  EngineResponseData,
  WorkerReady,
} from "./EngineWorkerProtocol.js";

declare const self: DedicatedWorkerGlobalScope;

const OPEN_JTALK_DICT_NAME = "open_jtalk_dic_utf_8-1.11.tgz";

/** engine-worker.js が置かれているディレクトリ。指定が無い場合のアセット基準 */
const defaultAssetBaseUrl = new URL("./", self.location.href).href;

let assetBaseUrl = defaultAssetBaseUrl;
let wasmEngine: WasmEngine | null = null;
let inferenceEngine: InferenceEngine | null = null;
let initializePromise: Promise<void> | null = null;

/**
 * ONNX セッションは .NET Runtime の初期化とは独立に扱う
 * /initialize_speaker が /version より先に来ても動くようにする
 */
function ensureInferenceEngine(): InferenceEngine {
  inferenceEngine ??= new InferenceEngine(assetBaseUrl);
  return inferenceEngine;
}

function dispatchInference(
  type: "yukarinS" | "yukarinSa" | "decode",
  data: unknown
): Promise<number[]> {
  const inference = ensureInferenceEngine();

  switch (type) {
    case "yukarinS": {
      const { length, phonemeList, speakerId } = data as {
        length: number;
        phonemeList: number[];
        speakerId: number[];
      };
      return inference.yukarinSForward(length, phonemeList, speakerId);
    }

    case "yukarinSa": {
      const {
        length,
        vowelPhonemeList,
        consonantPhonemeList,
        startAccentList,
        endAccentList,
        startAccentPhraseList,
        endAccentPhraseList,
        speakerId,
      } = data as {
        length: number;
        vowelPhonemeList: number[];
        consonantPhonemeList: number[];
        startAccentList: number[];
        endAccentList: number[];
        startAccentPhraseList: number[];
        endAccentPhraseList: number[];
        speakerId: number[];
      };
      return inference.yukarinSaForward(
        length,
        vowelPhonemeList,
        consonantPhonemeList,
        startAccentList,
        endAccentList,
        startAccentPhraseList,
        endAccentPhraseList,
        speakerId
      );
    }

    case "decode": {
      const { length, phonemeSize, f0, phoneme, speakerId } = data as {
        length: number;
        phonemeSize: number;
        f0: number[];
        phoneme: number[];
        speakerId: number[];
      };
      return inference.decodeForward(
        length,
        phonemeSize,
        f0,
        phoneme,
        speakerId
      );
    }
  }
}

/**
 * .NET Runtime と OpenJTalk 辞書を初期化する
 * 同時に複数回呼ばれても実際の初期化は1回だけ走る
 */
function ensureInitialized(requestedAssetBaseUrl?: string): Promise<void> {
  if (initializePromise) {
    return initializePromise;
  }

  if (requestedAssetBaseUrl != null) {
    assetBaseUrl = normalizeAssetBaseUrl(requestedAssetBaseUrl, self.location.href);
  }

  initializePromise = (async () => {
    const engine = new WasmEngine();
    engine.setInferenceHandler(dispatchInference);

    const dictionaryUrl = new URL(OPEN_JTALK_DICT_NAME, assetBaseUrl);
    const response = await fetch(dictionaryUrl);
    if (!response.ok) {
      throw new Error(
        `Dictionary download failed: ${response.status} (${dictionaryUrl.href})`
      );
    }

    await engine.initializeCore(new Uint8Array(await response.arrayBuffer()));
    wasmEngine = engine;
    console.log("[engine-worker] Engine initialized in dedicated worker");
  })();

  // 失敗した初期化は保持せず、次のリクエストでやり直せるようにする
  initializePromise.catch(() => {
    initializePromise = null;
    wasmEngine = null;
  });

  return initializePromise;
}

/**
 * .NET を必要とするコマンド用に、初期化済みの WasmEngine を得る
 * Worker が作り直された直後などは、ここで暗黙に初期化する
 */
async function requireWasmEngine(): Promise<WasmEngine> {
  if (!wasmEngine) {
    await ensureInitialized();
  }
  if (!wasmEngine) {
    throw new Error("Engine not initialized");
  }
  return wasmEngine;
}

async function handleRequest(request: EngineRequest): Promise<unknown> {
  switch (request.command) {
    case "initialize": {
      await ensureInitialized(request.data.assetBaseUrl);
      return { success: true } satisfies EngineResponseData["initialize"];
    }

    case "isInitializedSpeaker": {
      const initialized = ensureInferenceEngine().sessionInitialized(
        request.data.styleId
      );
      return {
        initialized,
      } satisfies EngineResponseData["isInitializedSpeaker"];
    }

    case "initializeSpeaker": {
      await ensureInferenceEngine().initializeSession(request.data.styleId);
      return { success: true } satisfies EngineResponseData["initializeSpeaker"];
    }

    case "audioQuery": {
      const json = await (await requireWasmEngine()).getAudioQuery(
        request.data.text,
        request.data.styleId
      );
      return { json } satisfies EngineResponseData["audioQuery"];
    }

    case "accentPhrases": {
      const json = await (await requireWasmEngine()).getAccentPhrases(
        request.data.text,
        request.data.styleId
      );
      return { json } satisfies EngineResponseData["accentPhrases"];
    }

    case "moraData": {
      const json = await (await requireWasmEngine()).getMoraData(
        request.data.accentPhrasesJson,
        request.data.styleId
      );
      return { json } satisfies EngineResponseData["moraData"];
    }

    case "synthesis": {
      const wave = await (await requireWasmEngine()).synthesize(
        request.data.audioQueryJson,
        request.data.styleId
      );
      return { buffer: wave.buffer } satisfies EngineResponseData["synthesis"];
    }

    default: {
      const { command } = request as { command: string };
      throw new Error(`Unknown command: ${command}`);
    }
  }
}

/**
 * コマンドは直列実行する
 * SynthesisExports が状態を共有しており、ONNX セッションも共有のため、
 * async handler の await 中に別リクエストが割り込むと破綻し得る
 */
let commandQueue: Promise<void> = Promise.resolve();

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  const request = event.data;
  if (!isEngineRequest(request)) {
    console.warn("[engine-worker] Unexpected message:", request);
    return;
  }

  commandQueue = commandQueue.then(async () => {
    let response: EngineResponse;
    try {
      response = {
        kind: "engineResponse",
        id: request.id,
        success: true,
        data: await handleRequest(request),
      };
    } catch (error) {
      console.error(`[engine-worker] ${request.command} failed:`, error);
      self.postMessage({
        kind: "engineResponse",
        id: request.id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies EngineResponse);
      return;
    }

    // WAV は所有権ごと渡す。転送後はこの buffer に触らない
    const buffer = getTransferableBuffer(response.data);
    self.postMessage(response, buffer ? [buffer] : []);
  });
});

self.postMessage({ kind: "workerReady" } satisfies WorkerReady);
