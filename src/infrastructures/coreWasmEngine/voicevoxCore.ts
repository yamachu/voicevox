/**
 * wasm32-unknown-emscripten 向けにビルドした VOICEVOX CORE のラッパー
 *
 * voicevox_core_wasm の voicevox_wasm_* 関数を呼ぶ。各関数は成功で 0 を返し、
 * 結果(JSON / WAV)または失敗時のエラーメッセージを Core 側の結果バッファに置く。
 *
 * DedicatedWorker 内で生成される想定。Core の呼び出しはすべて同期で、
 * 推論中はこのスレッドを占有する。
 */

/** Emscripten が生成する Module のうち、ここで使うもの */
type EmscriptenModule = {
  ccall(
    name: string,
    returnType: "number",
    argTypes: ("string" | "number")[],
    args: (string | number)[],
  ): number;
  FS: {
    mkdirTree(path: string): void;
    writeFile(path: string, data: Uint8Array): void;
    unlink(path: string): void;
  };
  HEAPU8: Uint8Array;
  _voicevox_wasm_result_pointer(): number;
  _voicevox_wasm_result_length(): number;
  _voicevox_wasm_is_loaded_style(styleId: number): number;
};

type EmscriptenModuleFactory = (
  moduleArg: Record<string, unknown>,
) => Promise<EmscriptenModule>;

/** VOICEVOX CORE の VoiceModelMeta の要素 */
export type CharacterMeta = {
  name: string;
  speaker_uuid: string;
  version: string;
  order?: number;
  styles: {
    name: string;
    id: number;
    type: "talk" | "singing_teacher" | "frame_decode" | "sing";
    order?: number;
  }[];
};

const textDecoder = new TextDecoder();

export class VoicevoxCore {
  private constructor(private readonly module: EmscriptenModule) {}

  /**
   * @param scriptUrl Emscripten が出力した ES module (MODULARIZE + EXPORT_ES6) の URL。
   *   .wasm は同じディレクトリから読む
   */
  static async load(scriptUrl: string): Promise<VoicevoxCore> {
    const { default: factory } = (await import(
      /* @vite-ignore */ scriptUrl
    )) as {
      default: EmscriptenModuleFactory;
    };
    const module = await factory({
      noInitialRun: true,
      locateFile: (path: string) => new URL(path, scriptUrl).href,
      // eslint-disable-next-line no-console
      print: (...values: unknown[]) => console.info("[core]", ...values),
      // eslint-disable-next-line no-console
      printErr: (...values: unknown[]) => console.warn("[core]", ...values),
    });
    return new VoicevoxCore(module);
  }

  /** Emscripten FS にファイルを書き込む。親ディレクトリは作成する */
  writeFile(path: string, data: Uint8Array): void {
    const parent = path.slice(0, path.lastIndexOf("/"));
    if (parent) {
      this.module.FS.mkdirTree(parent);
    }
    this.module.FS.writeFile(path, data);
  }

  unlink(path: string): void {
    this.module.FS.unlink(path);
  }

  /** ONNX Runtime と Open JTalk を初期化する。辞書は先に writeFile しておく */
  initialize(openJtalkDictDir: string): void {
    this.call("voicevox_wasm_initialize", ["string"], [openJtalkDictDir]);
  }

  /** FS 上の VVM を読み込み、その VVM のメタ情報を返す */
  loadVoiceModel(path: string): CharacterMeta[] {
    return this.callJson("voicevox_wasm_load_voice_model", ["string"], [path]);
  }

  metas(): CharacterMeta[] {
    return this.callJson("voicevox_wasm_metas", [], []);
  }

  isLoadedStyle(styleId: number): boolean {
    return this.module._voicevox_wasm_is_loaded_style(styleId) === 1;
  }

  createAudioQuery(text: string, styleId: number): string {
    return this.callText(
      "voicevox_wasm_create_audio_query",
      ["string", "number"],
      [text, styleId],
    );
  }

  createAccentPhrases(text: string, styleId: number): string {
    return this.callText(
      "voicevox_wasm_create_accent_phrases",
      ["string", "number"],
      [text, styleId],
    );
  }

  createAccentPhrasesFromKana(kana: string, styleId: number): string {
    return this.callText(
      "voicevox_wasm_create_accent_phrases_from_kana",
      ["string", "number"],
      [kana, styleId],
    );
  }

  replaceMoraData(accentPhrasesJson: string, styleId: number): string {
    return this.callText(
      "voicevox_wasm_replace_mora_data",
      ["string", "number"],
      [accentPhrasesJson, styleId],
    );
  }

  /** WAV を返す。返り値は独立した ArrayBuffer を持つので transfer してよい */
  synthesis(
    audioQueryJson: string,
    styleId: number,
    enableInterrogativeUpspeak: boolean,
  ): Uint8Array<ArrayBuffer> {
    return this.call(
      "voicevox_wasm_synthesis",
      ["string", "number", "number"],
      [audioQueryJson, styleId, enableInterrogativeUpspeak ? 1 : 0],
    );
  }

  /** Core の関数を呼び、結果バッファをコピーして返す */
  private call(
    name: string,
    argTypes: ("string" | "number")[],
    args: (string | number)[],
  ): Uint8Array<ArrayBuffer> {
    const resultCode = this.module.ccall(name, "number", argTypes, args);
    const pointer = this.module._voicevox_wasm_result_pointer();
    const length = this.module._voicevox_wasm_result_length();
    // メモリが拡張されると HEAPU8 は作り直されるため、呼び出し後に参照する
    const result = this.module.HEAPU8.slice(pointer, pointer + length);
    if (resultCode !== 0) {
      throw new Error(`${name}: ${textDecoder.decode(result)}`);
    }
    return result;
  }

  private callText(
    name: string,
    argTypes: ("string" | "number")[],
    args: (string | number)[],
  ): string {
    return textDecoder.decode(this.call(name, argTypes, args));
  }

  private callJson<T>(
    name: string,
    argTypes: ("string" | "number")[],
    args: (string | number)[],
  ): T {
    return JSON.parse(this.callText(name, argTypes, args)) as T;
  }
}
