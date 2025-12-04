/**
 * ServiceWorker からのリクエストをメインスレッドで処理するプロキシ
 * .NET WASMはServiceWorker内で動的importが禁止されているため、
 * メインスレッドで実行する必要がある
 */
import { MainThreadEngine } from "./MainThreadEngine.js";

let engine: MainThreadEngine | null = null;
let isInitialized = false;
let initPromise: Promise<void> | null = null;

// ServiceWorkerへのリクエストのコールバック管理
const pendingInferenceRequests = new Map<
  string,
  {
    resolve: (value: number[]) => void;
    reject: (reason: unknown) => void;
  }
>();

/**
 * ServiceWorkerに推論リクエストを送信
 */
async function sendInferenceToServiceWorker(
  inferenceType: "yukarinS" | "yukarinSa" | "decode",
  data: unknown
): Promise<number[]> {
  const registration = await navigator.serviceWorker.ready;
  const sw = registration.active;
  if (!sw) {
    throw new Error("No active ServiceWorker");
  }

  const id = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    pendingInferenceRequests.set(id, { resolve, reject });

    // 60秒でタイムアウト（decode は長い場合がある）
    setTimeout(() => {
      if (pendingInferenceRequests.has(id)) {
        pendingInferenceRequests.delete(id);
        reject(new Error("Inference request timeout"));
      }
    }, 60000);

    sw.postMessage({
      id,
      type: "inference",
      inferenceType,
      data,
    });
  });
}

/**
 * エンジンを初期化する
 */
async function initializeEngine(): Promise<void> {
  if (isInitialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    engine = new MainThreadEngine();

    // 推論ハンドラを設定（ServiceWorkerに委譲）
    engine.setInferenceHandler(sendInferenceToServiceWorker);

    const response = await fetch("./open_jtalk_dic_utf_8-1.11.tgz");
    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    await engine.initializeCore(uint8Array);

    isInitialized = true;
    console.log(
      "Engine initialized in main thread (inference delegated to ServiceWorker)"
    );
  })();

  return initPromise;
}

/**
 * ServiceWorkerからのメッセージを処理する
 */
async function handleMessage(
  event: MessageEvent /* TODO: 型付け */
): Promise<unknown> {
  const { type, data } = event.data as {
    type: string;
    data: Record<string, unknown>;
  };

  if (!engine && type !== "initialize") {
    throw new Error("Engine not initialized");
  }

  switch (type) {
    case "initialize":
      await initializeEngine();
      return { success: true };

    case "audioQuery": {
      const text = data.text as string;
      const styleId = data.styleId as number;
      const json = await engine!.getAudioQuery(text, styleId);
      return { json };
    }

    case "accentPhrases": {
      const text = data.text as string;
      const styleId = data.styleId as number;
      const json = await engine!.getAccentPhrases(text, styleId);
      return { json };
    }

    case "moraData": {
      const accentPhrasesJson = data.accentPhrasesJson as string;
      const styleId = data.styleId as number;
      const json = await engine!.getMoraData(accentPhrasesJson, styleId);
      return { json };
    }

    case "synthesis": {
      const audioQueryJson = data.audioQueryJson as string;
      const styleId = data.styleId as number;
      const uint8Array = await engine!.synthesize(audioQueryJson, styleId);
      return { buffer: uint8Array.buffer };
    }

    default:
      console.warn(`Unknown message type: ${type}`);
      return null;
  }
}

/**
 * ServiceWorkerからの推論レスポンスを処理
 */
function handleInferenceResponse(event: MessageEvent): boolean {
  const { id, type, success, data, error } = event.data as {
    id: string;
    type: string;
    success?: boolean;
    data?: number[];
    error?: string;
  };

  if (type !== "inferenceResponse") {
    return false;
  }

  const pending = pendingInferenceRequests.get(id);
  if (!pending) {
    return true;
  }

  pendingInferenceRequests.delete(id);

  if (success) {
    pending.resolve(data!);
  } else {
    pending.reject(new Error(error || "Inference failed"));
  }

  return true;
}

/**
 * ServiceWorkerとの通信を設定する
 */
export function setupServiceWorkerProxy(): void {
  if (!("serviceWorker" in navigator)) {
    console.warn("Service Worker is not supported");
    return;
  }

  // ServiceWorkerからのメッセージを受け取る
  navigator.serviceWorker.addEventListener("message", async (event) => {
    // 推論レスポンスの場合は別処理
    if (handleInferenceResponse(event)) {
      return;
    }

    const { id } = event.data as { id: string };

    try {
      const result = await handleMessage(event);
      // ServiceWorkerへ結果を返す（type: "response" で明示）
      event.source?.postMessage({
        id,
        type: "response",
        success: true,
        data: result,
      });
    } catch (error) {
      event.source?.postMessage({
        id,
        type: "response",
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  console.log("ServiceWorker proxy setup complete (with inference delegation)");
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
    const registration = await navigator.serviceWorker.register("/sw.js", {
      type: "module",
    });
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
