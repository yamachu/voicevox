import { Hono } from "hono";
import { fire } from "hono/service-worker";

declare const self: ServiceWorkerGlobalScope;

const app = new Hono().basePath("/sw");

app.get("/version", (c) => c.text("0.0.1"));

// マッチしないリクエストはネットワークにフォールバック
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
fire(app, { fetch: self.fetch.bind(self) });
