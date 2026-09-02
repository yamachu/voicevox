/**
 * ServiceWorker / Window / DedicatedWorker で共有する RPC のプロトコル定義
 *
 * ServiceWorker からのリクエストは Window を中継して DedicatedWorker に届き、
 * レスポンスは同じ経路を逆にたどる。3者が同じ型を参照するためここに集約する。
 */

export type EngineCommand =
  | "initialize"
  | "isInitializedSpeaker"
  | "initializeSpeaker"
  | "audioQuery"
  | "accentPhrases"
  | "moraData"
  | "synthesis";

/** コマンドごとのリクエストペイロード */
export type EngineRequestData = {
  /** assetBaseUrl は辞書・モデル・_framework の基準となる末尾 "/" 付き絶対URL */
  initialize: { assetBaseUrl?: string };
  isInitializedSpeaker: { styleId: number };
  initializeSpeaker: { styleId: number };
  audioQuery: { text: string; styleId: number };
  accentPhrases: { text: string; styleId: number };
  moraData: { accentPhrasesJson: string; styleId: number };
  synthesis: { audioQueryJson: string; styleId: number };
};

/** コマンドごとのレスポンスペイロード */
export type EngineResponseData = {
  initialize: { success: true };
  isInitializedSpeaker: { initialized: boolean };
  initializeSpeaker: { success: true };
  audioQuery: { json: string };
  accentPhrases: { json: string };
  moraData: { json: string };
  synthesis: { buffer: ArrayBuffer };
};

export type EngineRequest<C extends EngineCommand = EngineCommand> = {
  [K in C]: {
    kind: "engineRequest";
    id: string;
    command: K;
    data: EngineRequestData[K];
  };
}[C];

export type EngineResponse = {
  kind: "engineResponse";
  id: string;
} & (
  | { success: true; data: unknown }
  | { success: false; error: string }
);

/**
 * コマンドごとのタイムアウト(ms)
 *
 * initialize は engine-worker.js の取得・パース、22MB の辞書取得、
 * .NET ランタイム起動、辞書展開をすべて含むため長く取る。
 */
export const ENGINE_COMMAND_TIMEOUT_MS: Record<EngineCommand, number> = {
  initialize: 300000,
  // ONNX セッション生成（モデル取得 + WebGPU 初期化）
  initializeSpeaker: 180000,
  isInitializedSpeaker: 10000,
  audioQuery: 60000,
  accentPhrases: 60000,
  moraData: 60000,
  synthesis: 120000,
};

/**
 * Window 側のタイムアウト
 * ServiceWorker 側より僅かに短くして、必ず Worker 経路のエラーを返す
 */
export function windowTimeoutMs(command: EngineCommand): number {
  return Math.max(ENGINE_COMMAND_TIMEOUT_MS[command] - 5000, 5000);
}

/** DedicatedWorker が起動直後に一度だけ送る */
export type WorkerReady = { kind: "workerReady" };

export type EngineWorkerMessage = EngineResponse | WorkerReady;

export function isEngineRequest(value: unknown): value is EngineRequest {
  return (
    typeof value === "object" &&
    value != null &&
    (value as { kind?: unknown }).kind === "engineRequest"
  );
}

export function isEngineResponse(value: unknown): value is EngineResponse {
  return (
    typeof value === "object" &&
    value != null &&
    (value as { kind?: unknown }).kind === "engineResponse"
  );
}

/**
 * レスポンスに含まれる転送可能な ArrayBuffer を取り出す
 * synthesis の WAV をコピーせず所有権ごと渡すために使う
 */
export function getTransferableBuffer(data: unknown): ArrayBuffer | undefined {
  if (typeof data !== "object" || data == null) {
    return undefined;
  }
  const buffer = (data as { buffer?: unknown }).buffer;
  return buffer instanceof ArrayBuffer ? buffer : undefined;
}

/**
 * 末尾に "/" が付いた絶対URLへ正規化する
 * GitHub Pages のようにサブパス配信される場合の相対解決を安定させる
 */
export function normalizeAssetBaseUrl(base: string, from: string): string {
  const url = new URL(base, from);
  if (!url.pathname.endsWith("/")) {
    url.pathname += "/";
  }
  return url.href;
}
