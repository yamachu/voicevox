/**
 * ServiceWorker
 * - API リクエストのルーティング
 * - ENGINE 処理は Window 経由で DedicatedWorker に委譲する
 */
import { Hono } from "hono";
import { handle } from "hono/service-worker";
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
import { isEngineResponse } from "./EngineWorkerProtocol.js";
import type {
  EngineCommand,
  EngineRequest,
  EngineRequestData,
  EngineResponseData,
} from "./EngineWorkerProtocol.js";

declare const self: ServiceWorkerGlobalScope;

// Window へのリクエストのコールバック管理
const pendingRequests = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
  }
>();

/**
 * ENGINE を持つ Window にリクエストを送り、結果を待つ
 *
 * 実処理は Window がさらに DedicatedWorker へ転送する。
 * NOTE: 現状は最初の Window を選ぶため、複数タブでは要求元とは別のタブの
 * ENGINE が使われ得る。fetch event の clientId で宛先を選べるようにするのは別課題。
 */
async function sendToEngineClient<C extends EngineCommand>(
  command: C,
  data: EngineRequestData[C]
): Promise<EngineResponseData[C]> {
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
        reject(new Error(`Request timeout: ${command}`));
      }
    }, 60000);

    client.postMessage({
      kind: "engineRequest",
      id,
      command,
      data,
    } satisfies EngineRequest<C>);
  });
}

/**
 * Window からのレスポンスを処理
 */
function handleEngineResponse(event: ExtendableMessageEvent): void {
  const message = event.data as unknown;
  if (!isEngineResponse(message)) {
    console.warn("Unexpected message in ServiceWorker:", message);
    return;
  }

  const pending = pendingRequests.get(message.id);
  if (!pending) return;

  pendingRequests.delete(message.id);

  if (message.success) {
    pending.resolve(message.data);
  } else {
    pending.reject(new Error(message.error || "Unknown error"));
  }
}

// BASE_URL は "/" や "./" のようなパスにも
// "https://example.github.io/voicevox/" のような絶対URLにもなり得るため、
// self.location を基準に解決してからパス部分だけを取り出す。
// Vite は base を必ず "/" 終わりに正規化するので、末尾の "/" は落とす
const basePath = new URL(
  import.meta.env.BASE_URL || "/",
  self.location.href
).pathname.replace(/\/+$/, "");
const engineBasePath = `${basePath}/sw`;
const app = new Hono().basePath(engineBasePath);

app.get("/version", async (c) => {
  await sendToEngineClient("initialize", {});

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

  const { initialized } = await sendToEngineClient("isInitializedSpeaker", {
    styleId: numericStyleId,
  });

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

  await sendToEngineClient("initializeSpeaker", { styleId: numericStyleId });

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

  const result = await sendToEngineClient("audioQuery", {
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

  const result = await sendToEngineClient("accentPhrases", {
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

  const result = await sendToEngineClient("moraData", {
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

  const result = await sendToEngineClient("synthesis", {
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

// 新しい ServiceWorker を待たせずに有効化する
//
// 既定では新しい sw.js はインストール後 waiting のまま留まり、
// そのサイトのタブを全部閉じるまで古い ServiceWorker が制御を続ける。
// sw-proxy.js は新しいものが読まれるため、
// 新旧でRPCのプロトコルが食い違って ENGINE が動かなくなる。
self.addEventListener("install", () => {
  void self.skipWaiting();
});

self.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(self.clients.claim());
});

// Window からのレスポンスを処理
self.addEventListener("message", (event: ExtendableMessageEvent) => {
  handleEngineResponse(event);
});

self.addEventListener("fetch", (event: FetchEvent) => {
  const url = new URL(event.request.url);

  // /sw で始まるリクエストのみ処理
  if (url.pathname.startsWith(engineBasePath)) {
    console.log(`SW Fetch: ${url.pathname}`);
    handle(app)(event);
  }
  // その他のリクエストはネットワークにフォールバック
});
