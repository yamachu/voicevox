/**
 * ServiceWorker
 * - API リクエストのルーティング
 * - ONNX 推論の実行
 * - メインスレッドとの双方向通信
 */
import { Hono } from "hono";
import {
  dummyEngineManifest,
  dummySpeakerInfo,
  dummySpeakers,
  dummySupportedDevices,
} from "./Contract.js";
import {
  InvalidRequestFieldError,
  InvalidRequestFieldTypeError,
} from "./Error.js";
import { InferenceWorker } from "./InferenceWorker.js";

declare const self: ServiceWorkerGlobalScope;

// 推論エンジン（ServiceWorker内で実行）
const inferenceWorker = new InferenceWorker();

// メインスレッドへのリクエストのコールバック管理
const pendingRequests = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
  }
>();

/**
 * メインスレッドにリクエストを送信し、結果を待つ
 * audioQuery, accentPhrases, moraData, synthesis など .NET 処理用
 */
async function sendToMainThread<T>(
  type: string,
  data: Record<string, unknown> = {}
): Promise<T> {
  const clients = await self.clients.matchAll({ type: "window" });

  if (clients.length === 0) {
    throw new Error("No client available to handle request");
  }

  const client = clients[0];
  const id = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    pendingRequests.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
    });

    // 60秒でタイムアウト（synthesisが長い場合を考慮）
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error("Request timeout"));
      }
    }, 60000);

    client.postMessage({ id, type, data });
  });
}

/**
 * メインスレッドからのレスポンスを処理
 */
function handleMainThreadResponse(event: ExtendableMessageEvent): void {
  const { id, success, data, error } = event.data as {
    id: string;
    success: boolean;
    data?: unknown;
    error?: string;
  };

  const pending = pendingRequests.get(id);
  if (!pending) return;

  pendingRequests.delete(id);

  if (success) {
    pending.resolve(data);
  } else {
    pending.reject(new Error(error || "Unknown error"));
  }
}

/**
 * メインスレッドからの推論リクエストを処理
 */
async function handleInferenceRequest(
  event: ExtendableMessageEvent
): Promise<void> {
  const { id, type, inferenceType, data } = event.data as {
    id: string;
    type: string;
    inferenceType?: "yukarinS" | "yukarinSa" | "decode";
    data?: Record<string, unknown>;
  };

  // レスポンスの場合（sendToMainThread への返答）
  if (type === "response") {
    handleMainThreadResponse(event);
    return;
  }

  // 推論リクエストの場合
  if (type !== "inference" || !inferenceType || !data) {
    return;
  }

  const clients = await self.clients.matchAll({ type: "window" });
  const client = clients[0];
  if (!client) return;

  try {
    let result: number[];

    switch (inferenceType) {
      case "yukarinS": {
        const { length, phonemeList, speakerId } = data as {
          length: number;
          phonemeList: number[];
          speakerId: number[];
        };
        result = await inferenceWorker.yukarinSForward(
          length,
          phonemeList,
          speakerId
        );
        break;
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
        result = await inferenceWorker.yukarinSaForward(
          length,
          vowelPhonemeList,
          consonantPhonemeList,
          startAccentList,
          endAccentList,
          startAccentPhraseList,
          endAccentPhraseList,
          speakerId
        );
        break;
      }

      case "decode": {
        const { length, phonemeSize, f0, phoneme, speakerId } = data as {
          length: number;
          phonemeSize: number;
          f0: number[];
          phoneme: number[];
          speakerId: number[];
        };
        result = await inferenceWorker.decodeForward(
          length,
          phonemeSize,
          f0,
          phoneme,
          speakerId
        );
        break;
      }

      default:
        throw new Error(`Unknown inference type: ${inferenceType}`);
    }

    client.postMessage({
      id,
      type: "inferenceResponse",
      success: true,
      data: result,
    });
  } catch (error) {
    client.postMessage({
      id,
      type: "inferenceResponse",
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const app = new Hono().basePath("/sw");

app.get("/version", async (c) => {
  await sendToMainThread("initialize");

  return c.text("0.0.1");
});

app.get("/engine_manifest", (c) => c.json(dummyEngineManifest));

app.get("/supported_devices", (c) => c.json(dummySupportedDevices));

app.get("/is_initialized_speaker", async (c) => {
  const styleId = c.req.query("speaker");
  if (styleId === undefined) {
    throw new InvalidRequestFieldError("speaker");
  }
  const numericStyleId = Number(styleId);
  if (Number.isNaN(numericStyleId)) {
    throw new InvalidRequestFieldTypeError("speaker", "number");
  }

  // ServiceWorker 内のセッション状態をチェック
  const initialized = inferenceWorker.sessionInitialized(numericStyleId);

  return c.json(initialized);
});

app.post("/initialize_speaker", async (c) => {
  const styleId = c.req.query("speaker");
  if (styleId === undefined) {
    throw new InvalidRequestFieldError("speaker");
  }
  const numericStyleId = Number(styleId);
  if (Number.isNaN(numericStyleId)) {
    throw new InvalidRequestFieldTypeError("speaker", "number");
  }

  // ServiceWorker 内でセッション初期化
  await inferenceWorker.initializeSession(numericStyleId);

  return c.body(null, 204);
});

app.get("/speakers", (c) => c.json(dummySpeakers));

app.get("/speaker_info", (c) => {
  const speakerUuid = c.req.query("speaker_uuid");
  if (speakerUuid === undefined) {
    throw new InvalidRequestFieldError("speaker_uuid");
  }

  return c.json(dummySpeakerInfo);
});

app.post("/audio_query", async (c) => {
  const text = c.req.query("text");
  if (text === undefined) {
    throw new InvalidRequestFieldError("text");
  }
  const styleId = c.req.query("speaker");
  if (styleId === undefined) {
    throw new InvalidRequestFieldError("speaker");
  }
  const numericStyleId = Number(styleId);
  if (Number.isNaN(numericStyleId)) {
    throw new InvalidRequestFieldTypeError("speaker", "number");
  }

  const result = await sendToMainThread<{ json: string }>("audioQuery", {
    text,
    styleId: numericStyleId,
  });

  return c.body(result.json, 200, { "Content-Type": "application/json" });
});

app.post("/accent_phrases", async (c) => {
  const text = c.req.query("text");
  if (text === undefined) {
    throw new InvalidRequestFieldError("text");
  }
  const styleId = c.req.query("speaker");
  if (styleId === undefined) {
    throw new InvalidRequestFieldError("speaker");
  }
  const numericStyleId = Number(styleId);
  if (Number.isNaN(numericStyleId)) {
    throw new InvalidRequestFieldTypeError("speaker", "number");
  }

  const result = await sendToMainThread<{ json: string }>("accentPhrases", {
    text,
    styleId: numericStyleId,
  });

  return c.body(result.json, 200, { "Content-Type": "application/json" });
});

app.post("/mora_data", async (c) => {
  const styleId = c.req.query("speaker");
  if (styleId === undefined) {
    throw new InvalidRequestFieldError("speaker");
  }
  const numericStyleId = Number(styleId);
  if (Number.isNaN(numericStyleId)) {
    throw new InvalidRequestFieldTypeError("speaker", "number");
  }

  const accentPhrasesJson = await c.req.text();

  const result = await sendToMainThread<{ json: string }>("moraData", {
    accentPhrasesJson,
    styleId: numericStyleId,
  });

  return c.body(result.json, 200, { "Content-Type": "application/json" });
});

app.post("/synthesis", async (c) => {
  const styleId = c.req.query("speaker");
  if (styleId === undefined) {
    throw new InvalidRequestFieldError("speaker");
  }
  const numericStyleId = Number(styleId);
  if (Number.isNaN(numericStyleId)) {
    throw new InvalidRequestFieldTypeError("speaker", "number");
  }

  const audioQueryJson = await c.req.text();

  const result = await sendToMainThread<{ buffer: ArrayBuffer }>("synthesis", {
    audioQueryJson,
    styleId: numericStyleId,
  });

  return new Response(new Blob([result.buffer], { type: "audio/wav" }));
});

app.get("/user_dict", (c) => {
  return c.json({});
});

app.onError((err, c) => {
  if (
    err instanceof InvalidRequestFieldError ||
    err instanceof InvalidRequestFieldTypeError
  ) {
    return c.json(
      {
        msg: err.message,
        type: err.name,
        loc: [],
      },
      422
    );
  }

  console.error("ServiceWorker error:", err);

  return c.json(
    {
      msg: "Internal Server Error",
      type: "InternalServerError",
      loc: [],
    },
    500
  );
});

// Service Workerのイベントハンドラを設定
self.addEventListener("install", () => {
  console.log("ServiceWorker installing...");
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  console.log("ServiceWorker activating...");
  event.waitUntil(self.clients.claim());
});

// メインスレッドからのメッセージを処理
self.addEventListener("message", (event: ExtendableMessageEvent) => {
  handleInferenceRequest(event);
});

self.addEventListener("fetch", (event: FetchEvent) => {
  const url = new URL(event.request.url);

  // /sw で始まるリクエストのみ処理
  if (url.pathname.startsWith("/sw")) {
    event.respondWith(
      (async () => {
        const response = await app.fetch(event.request);
        // 404の場合はネットワークにフォールバック
        if (response.status === 404) {
          return fetch(event.request);
        }
        return response;
      })()
    );
  }
  // その他のリクエストはネットワークにフォールバック
});
