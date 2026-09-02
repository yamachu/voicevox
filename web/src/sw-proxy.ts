/**
 * ServiceWorker と DedicatedWorker を仲介するプロキシ
 *
 * ENGINE の実処理（.NET Wasm / OpenJTalk / ONNX 推論 / WAV 生成）は
 * すべて engine-worker.js の中で動く。Window に残るのはメッセージの中継だけ。
 *
 * ServiceWorker は .NET Wasm の動的 import が禁止されているため直接は動かせず、
 * また停止・再起動され得るため、Worker の所有はページ側（Window）で行う。
 */
import {
  getTransferableBuffer,
  isEngineResponse,
  normalizeAssetBaseUrl,
} from "./EngineWorkerProtocol.js";
import type {
  EngineRequest,
  EngineResponse,
} from "./EngineWorkerProtocol.js";

/** 辞書・モデル・_framework の基準URL。このスクリプトと同じディレクトリ */
const assetBaseUrl = normalizeAssetBaseUrl("./", import.meta.url);

/** ServiceWorker 側のタイムアウト(60秒)より僅かに短くして、必ずエラーを返す */
const REQUEST_TIMEOUT_MS = 55000;

/** Worker が続けて落ちる場合に無限再生成しないための制限 */
const MAX_RESTART_COUNT = 3;
const RESTART_WINDOW_MS = 60000;

/** 応答の宛先。ServiceWorker からのメッセージなので Window ではない */
type ResponseTarget = ServiceWorker | MessagePort;

/** リクエストIDごとに、応答を返すべき ServiceWorker を覚えておく */
const responseTargets = new Map<
  string,
  { target: ResponseTarget; timeoutId: number }
>();

let engineWorker: Worker | null = null;
let restartCount = 0;
let restartWindowStartedAt = 0;

function respond(id: string, response: EngineResponse, buffer?: ArrayBuffer) {
  const pending = responseTargets.get(id);
  if (!pending) return;

  responseTargets.delete(id);
  clearTimeout(pending.timeoutId);

  try {
    pending.target.postMessage(response, buffer ? [buffer] : []);
  } catch (error) {
    console.error("Failed to forward engine response:", error);
  }
}

function failAllPending(reason: string) {
  for (const id of [...responseTargets.keys()]) {
    respond(id, {
      kind: "engineResponse",
      id,
      success: false,
      error: reason,
    });
  }
}

/**
 * Worker を破棄する。次のリクエストで再生成される
 */
function teardownEngineWorker(reason: string) {
  if (engineWorker) {
    engineWorker.terminate();
    engineWorker = null;
  }
  failAllPending(reason);
}

function createEngineWorker(): Worker {
  // NOTE: Vite の worker 変換に拾われないよう、URL は変数経由で組み立てる
  const workerFileName = "./engine-worker.js";
  const worker = new Worker(new URL(workerFileName, import.meta.url), {
    type: "module",
  });

  worker.addEventListener("message", (event: MessageEvent<unknown>) => {
    const message = event.data;
    if (!isEngineResponse(message)) {
      // workerReady など。ログだけ出して無視する
      return;
    }

    const buffer = message.success
      ? getTransferableBuffer(message.data)
      : undefined;
    respond(message.id, message, buffer);
  });

  worker.addEventListener("error", (event) => {
    console.error("Engine worker error:", event.message);
    teardownEngineWorker(`Engine worker error: ${event.message}`);
  });

  worker.addEventListener("messageerror", () => {
    console.error("Engine worker message could not be deserialized");
    teardownEngineWorker("Engine worker message error");
  });

  return worker;
}

function ensureEngineWorker(): Worker {
  if (engineWorker) {
    return engineWorker;
  }

  const now = Date.now();
  if (now - restartWindowStartedAt > RESTART_WINDOW_MS) {
    restartWindowStartedAt = now;
    restartCount = 0;
  }
  if (restartCount >= MAX_RESTART_COUNT) {
    throw new Error(
      `Engine worker failed ${MAX_RESTART_COUNT} times, giving up. Reload the page.`
    );
  }
  restartCount++;

  engineWorker = createEngineWorker();
  return engineWorker;
}

/**
 * ServiceWorker から来た ENGINE リクエストを Worker へ転送する
 */
function forwardToEngineWorker(request: EngineRequest, target: ResponseTarget) {
  let worker: Worker;
  try {
    worker = ensureEngineWorker();
  } catch (error) {
    target.postMessage({
      kind: "engineResponse",
      id: request.id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    } satisfies EngineResponse);
    return;
  }

  const timeoutId = window.setTimeout(() => {
    respond(request.id, {
      kind: "engineResponse",
      id: request.id,
      success: false,
      error: `Engine worker request timeout: ${request.command}`,
    });
  }, REQUEST_TIMEOUT_MS);

  responseTargets.set(request.id, { target, timeoutId });

  // initialize には Window が把握しているアセット基準URLを渡す
  const forwarded: EngineRequest =
    request.command === "initialize"
      ? {
          ...request,
          data: { assetBaseUrl: request.data.assetBaseUrl ?? assetBaseUrl },
        }
      : request;

  worker.postMessage(forwarded);
}

/**
 * ServiceWorkerとの通信を設定する
 */
export function setupServiceWorkerProxy(): void {
  if (!("serviceWorker" in navigator)) {
    console.warn("Service Worker is not supported");
    return;
  }

  navigator.serviceWorker.addEventListener("message", (event) => {
    const request = event.data as unknown;
    if (
      typeof request !== "object" ||
      request == null ||
      (request as { kind?: unknown }).kind !== "engineRequest"
    ) {
      console.warn("Unexpected message from ServiceWorker:", request);
      return;
    }

    // 応答は必ずリクエスト元の ServiceWorker へ返す
    // navigator.serviceWorker.controller とは一致しない場合がある
    const target = event.source;
    if (!(target instanceof ServiceWorker) && !(target instanceof MessagePort)) {
      console.warn("Engine request has no source to respond to");
      return;
    }

    forwardToEngineWorker(request as EngineRequest, target);
  });

  // NOTE: DedicatedWorker はページが破棄されると自動的に終了するため、
  // pagehide 等で明示的に terminate はしない（back/forward cache で復帰した際に
  // ランタイムを失うのを避ける）

  console.log("ServiceWorker proxy setup complete (engine runs in a worker)");
}

/**
 * ServiceWorkerを登録し、プロキシを設定する
 */
export async function registerServiceWorkerWithProxy(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) {
    console.warn("Service Worker is not supported");
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register(
      new URL("./sw.js", import.meta.url),
      { type: "module" }
    );
    console.log("ServiceWorker registered:", registration);

    setupServiceWorkerProxy();

    // ServiceWorkerがアクティブになるのを待つ
    if (registration.active) {
      return registration;
    }

    await new Promise<void>((resolve) => {
      const sw = registration.installing || registration.waiting;
      if (!sw) {
        resolve();
        return;
      }
      sw.addEventListener("statechange", () => {
        if (sw.state === "activated") {
          resolve();
        }
      });
    });

    return registration;
  } catch (error) {
    console.error("ServiceWorker registration failed:", error);
    return null;
  }
}
