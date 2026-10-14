/**
 * メインスレッドとCore wasmを動かすWorkerの間のRPCのプロトコル
 */
import type { CharacterMeta } from "./voicevoxCore";

/** コマンドごとの引数と返り値 */
export type CoreWasmCommands = {
  /** assetBaseUrl はCore・辞書・音声モデルを置いたディレクトリの、末尾"/"付きの絶対URL */
  initialize: { request: { assetBaseUrl: string }; response: void };
  metas: { request: void; response: CharacterMeta[] };
  isLoadedStyle: { request: { styleId: number }; response: boolean };
  /** 以下、JSONはVOICEVOX ENGINEのHTTP APIと同じ形式 */
  audioQuery: {
    request: { text: string; styleId: number };
    response: string;
  };
  accentPhrases: {
    request: { text: string; isKana: boolean; styleId: number };
    response: string;
  };
  moraData: {
    request: { accentPhrasesJson: string; styleId: number };
    response: string;
  };
  synthesis: {
    request: {
      audioQueryJson: string;
      styleId: number;
      enableInterrogativeUpspeak: boolean;
    };
    response: Uint8Array<ArrayBuffer>;
  };
};

export type CoreWasmCommand = keyof CoreWasmCommands;

export type CoreWasmRequest = {
  [C in CoreWasmCommand]: {
    id: number;
    command: C;
    data: CoreWasmCommands[C]["request"];
  };
}[CoreWasmCommand];

export type CoreWasmResponse = { id: number } & (
  | { success: true; data: unknown }
  | { success: false; error: string }
);
