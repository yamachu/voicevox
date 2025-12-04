import { Hono } from "hono";
import { fire } from "hono/service-worker";
import {
  dummyEngineManifest,
  dummySpeakerInfo,
  dummySpeakers,
  dummySupportedDevices,
} from "./Contract.js";
import { Engine } from "./Engine.js";
import {
  InvalidRequestFieldError,
  InvalidRequestFieldTypeError,
} from "./Error.js";

declare const self: ServiceWorkerGlobalScope;

const engine = new Engine();

const app = new Hono().basePath("/sw");

app.get("/version", async (c) => {
  // GETで初期化するなではあるんだけど、ここぐらいしかなくて…
  const response = await fetch("./open_jtalk_dic_utf_8-1.11.tgz");
  const arrayBuffer = await response.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  await engine.initializeCore(uint8Array);

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

  const isInitialized = engine.sessionInitialized(numericStyleId);

  return c.json(isInitialized);
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

  await engine.initializeSession(numericStyleId);

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

  const json = await engine.getAudioQuery(text, numericStyleId);

  return c.body(json, 200, { type: "application/json" });
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

  const json = await engine.getAccentPhrases(text, numericStyleId);

  return c.body(json, 200, { type: "application/json" });
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

  const json = await engine.getMoraData(accentPhrasesJson, numericStyleId);

  return c.body(json, 200, { type: "application/json" });
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

  const uint8Array = await engine.synthesize(audioQueryJson, numericStyleId);

  return new Response(new Blob([uint8Array], { type: "audio/wav" }));
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
