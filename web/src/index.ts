import { Hono } from "hono";
import { fire } from "hono/service-worker";
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

declare const self: ServiceWorkerGlobalScope;

const app = new Hono().basePath("/sw");

app.get("/version", async (c) => {
  // MEMO: ここぐらいしかDictionaryのMountとかをして初期化する場所ないよな…？
  return c.text("0.0.1");
});

app.get("/engine_manifest", (c) => c.json(dummyEngineManifest));

app.get("/supported_devices", (c) => c.json(dummySupportedDevices));

app.get("/is_initialized_speaker", (c) => {
  const styleId = c.req.query("speaker");
  if (styleId === undefined) {
    throw new InvalidRequestFieldError("speaker");
  }
  const numericStyleId = Number(styleId);
  if (Number.isNaN(numericStyleId)) {
    throw new InvalidRequestFieldTypeError("speaker", "number");
  }

  // Mapに格納したのを取得できたらtrue、なければfalseを返す想定

  return c.json(true);
});

app.post("/initialize_speaker", (c) => {
  const styleId = c.req.query("speaker");
  if (styleId === undefined) {
    throw new InvalidRequestFieldError("speaker");
  }
  const numericStyleId = Number(styleId);
  if (Number.isNaN(numericStyleId)) {
    throw new InvalidRequestFieldTypeError("speaker", "number");
  }

  // getSessionなどで管理しているMapに格納する想定

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

app.post("/audio_query", (c) => {
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

  // TODO: Impl

  return c.json({});
});

app.post("/accent_phrases", (c) => {
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

  // TODO: Impl

  return c.json([]);
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

  // TODO: Impl

  return c.json([]);
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

  // TODO: Impl

  return c.body(new Blob([], { type: "audio/wav" }));
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

  return c.json(
    {
      msg: "Internal Server Error",
      type: "InternalServerError",
      loc: [],
    },
    500
  );
});

// マッチしないリクエストはネットワークにフォールバック
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
fire(app, { fetch: self.fetch.bind(self) });
