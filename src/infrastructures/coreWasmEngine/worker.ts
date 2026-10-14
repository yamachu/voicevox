/**
 * wasm32-unknown-emscripten 向けにビルドした VOICEVOX CORE（ONNX Runtime を静的リンク済み）を動かすWorker
 *
 * Core と、その Emscripten FS 上の OpenJTalk 辞書・音声モデルのすべてをこのWorkerが所有する。
 * Core の呼び出しは同期で重いため、メインスレッドを止めないようWorkerで動かす。
 */
/// <reference lib="webworker" />

/* eslint-disable no-console -- Workerからはwindow.backend経由のロガーが使えない */

import { gunzip, readTar } from "./tar";
import { VoicevoxCore } from "./voicevoxCore";
import type {
  CoreWasmCommands,
  CoreWasmRequest,
  CoreWasmResponse,
} from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

/** voicevox_core_wasm のビルド成果物。.wasm も同じディレクトリに置く */
const CORE_SCRIPT_PATH = "wasm_browser_api_example.js";
const OPEN_JTALK_DICT_ARCHIVE_PATH = "open_jtalk_dic_utf_8-1.11.tgz";
/** アーカイブを FS の "/" に展開したときの辞書ディレクトリ */
const OPEN_JTALK_DICT_DIR = "/open_jtalk_dic_utf_8-1.11";
/** 読み込む VVM のファイル名の配列(JSON)。VVM は models/ に置く */
const VOICE_MODEL_INDEX_PATH = "models/index.json";

let initializePromise: Promise<VoicevoxCore> | undefined;

async function fetchBytes(url: URL): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} (${url.href})`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function fetchVoiceModelFileNames(url: URL): Promise<string[]> {
  const index = JSON.parse(
    new TextDecoder().decode(await fetchBytes(url)),
  ) as unknown;
  if (
    !Array.isArray(index) ||
    !index.every((name): name is string => typeof name === "string")
  ) {
    throw new Error(`${url.href} must be an array of file names`);
  }
  return index;
}

/** Core と OpenJTalk 辞書を初期化し、全 VVM を読み込む */
async function initialize(assetBaseUrl: string): Promise<VoicevoxCore> {
  // 初期化は数十秒かかるため、どの段階が重いか分かるよう計測する
  const startedAt = performance.now();
  const elapsed = () => `${Math.round(performance.now() - startedAt)}ms`;
  const resolve = (path: string) => new URL(path, assetBaseUrl);

  const [core, dictionaryArchive, voiceModelFileNames] = await Promise.all([
    VoicevoxCore.load(resolve(CORE_SCRIPT_PATH).href),
    fetchBytes(resolve(OPEN_JTALK_DICT_ARCHIVE_PATH)),
    fetchVoiceModelFileNames(resolve(VOICE_MODEL_INDEX_PATH)),
  ]);
  console.info(`[coreWasmEngine] Loaded core and dictionary in ${elapsed()}`);

  for (const { path, data } of readTar(await gunzip(dictionaryArchive))) {
    core.writeFile(`/${path}`, data);
  }
  core.initialize(OPEN_JTALK_DICT_DIR);
  console.info(`[coreWasmEngine] Initialized core in ${elapsed()}`);

  // VVM は大きいため、1つずつ FS に書いて読み込み、すぐ FS から消す
  for (const fileName of voiceModelFileNames) {
    const path = `/models/${fileName}`;
    core.writeFile(path, await fetchBytes(resolve(`models/${fileName}`)));
    try {
      const metas = core.loadVoiceModel(path);
      console.info(
        `[coreWasmEngine] Loaded ${fileName} (${metas
          .map((character) => character.name)
          .join(", ")}) in ${elapsed()}`,
      );
    } finally {
      core.unlink(path);
    }
  }

  return core;
}

function requireCore(): Promise<VoicevoxCore> {
  if (initializePromise == undefined) {
    throw new Error("Core is not initialized");
  }
  return initializePromise;
}

async function handleRequest(request: CoreWasmRequest): Promise<unknown> {
  switch (request.command) {
    case "initialize": {
      if (initializePromise == undefined) {
        initializePromise = initialize(request.data.assetBaseUrl);
        // 失敗した初期化は保持せず、次の呼び出しでやり直せるようにする
        initializePromise.catch(() => {
          initializePromise = undefined;
        });
      }
      await initializePromise;
      return undefined satisfies CoreWasmCommands["initialize"]["response"];
    }
    case "metas":
      return (
        await requireCore()
      ).metas() satisfies CoreWasmCommands["metas"]["response"];
    case "isLoadedStyle":
      return (await requireCore()).isLoadedStyle(
        request.data.styleId,
      ) satisfies CoreWasmCommands["isLoadedStyle"]["response"];
    case "audioQuery":
      return (await requireCore()).createAudioQuery(
        request.data.text,
        request.data.styleId,
      ) satisfies CoreWasmCommands["audioQuery"]["response"];
    case "accentPhrases": {
      const core = await requireCore();
      const { text, isKana, styleId } = request.data;
      return (
        isKana
          ? core.createAccentPhrasesFromKana(text, styleId)
          : core.createAccentPhrases(text, styleId)
      ) satisfies CoreWasmCommands["accentPhrases"]["response"];
    }
    case "moraData":
      return (await requireCore()).replaceMoraData(
        request.data.accentPhrasesJson,
        request.data.styleId,
      ) satisfies CoreWasmCommands["moraData"]["response"];
    case "synthesis":
      return (await requireCore()).synthesis(
        request.data.audioQueryJson,
        request.data.styleId,
        request.data.enableInterrogativeUpspeak,
      ) satisfies CoreWasmCommands["synthesis"]["response"];
  }
}

/**
 * コマンドは直列実行する
 * 初期化の await 中に別のコマンドが来ても、Core を並行して触らないようにする
 */
let commandQueue: Promise<void> = Promise.resolve();

self.addEventListener("message", (event: MessageEvent<CoreWasmRequest>) => {
  const request = event.data;
  commandQueue = commandQueue.then(async () => {
    let response: CoreWasmResponse;
    try {
      response = {
        id: request.id,
        success: true,
        data: await handleRequest(request),
      };
    } catch (error) {
      console.error(`[coreWasmEngine] ${request.command} failed:`, error);
      response = {
        id: request.id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    // WAV は所有権ごと渡す
    const transfer =
      response.success && response.data instanceof Uint8Array
        ? [response.data.buffer]
        : [];
    self.postMessage(response, transfer);
  });
});
