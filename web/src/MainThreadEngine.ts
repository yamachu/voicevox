/**
 * メインスレッド用エンジン
 * .NET Wasm Runtime に関する処理を実行する
 */
import { initialize } from "@voicevoxenginesharp-wasm-web/core";

type InferenceHandler = (
  type: "yukarinS" | "yukarinSa" | "decode",
  data: unknown
) => Promise<number[]>;

export class MainThreadEngine {
  private isInitialized: boolean = false;
  private initializeInProgress: boolean = false;
  private dotnetExportedFunctions: Awaited<
    ReturnType<typeof initialize>
  > | null = null;
  private inferenceHandler: InferenceHandler | null = null;

  constructor() {
    // 推論ハンドラを .NET に注入するためにバインド
    this.proxyYukarinSForward = this.proxyYukarinSForward.bind(this);
    this.proxyYukarinSaForward = this.proxyYukarinSaForward.bind(this);
    this.proxyDecodeForward = this.proxyDecodeForward.bind(this);
  }

  /**
   * 推論ハンドラを設定（ServiceWorkerへの委譲用）
   */
  setInferenceHandler(handler: InferenceHandler): void {
    this.inferenceHandler = handler;
  }

  async initializeCore(openJTalkDictArray: Uint8Array): Promise<void> {
    if (this.initializeInProgress) {
      return Promise.reject(new Error("Initialization already in progress"));
    }
    if (this.isInitialized) {
      return Promise.resolve();
    }
    this.initializeInProgress = true;

    // .NET Wasm ランタイムを初期化
    // 推論は ServiceWorker に委譲するプロキシを注入
    const exportedFunction = await initialize({
      decodeForward: this.proxyDecodeForward,
      yukarinSForward: this.proxyYukarinSForward,
      yukarinSaForward: this.proxyYukarinSaForward,
    });

    this.dotnetExportedFunctions = exportedFunction;

    await exportedFunction.VoicevoxEngineSharp.WasmWeb.IOHelper.MountDictionaryAsync(
      openJTalkDictArray
    )
      .then(() => {
        console.log("✓ Mounted dictionary");
      })
      .then(() => {
        exportedFunction.VoicevoxEngineSharp.WasmWeb.SynthesisExports.Initialize(
          "/tmp/open_jtalk_dic_utf_8-1.11"
        );
        console.log("✓ Initialized synthesis exports");
      })
      .then(() => {
        this.isInitialized = true;
        this.initializeInProgress = false;
      });
  }

  async getAudioQuery(text: string, speakerId: number): Promise<string> {
    if (!this.dotnetExportedFunctions) {
      throw new Error("Core not initialized");
    }
    return this.dotnetExportedFunctions.VoicevoxEngineSharp.WasmWeb.SynthesisExports.AudioQuery(
      text,
      speakerId
    );
  }

  async getAccentPhrases(text: string, speakerId: number): Promise<string> {
    if (!this.dotnetExportedFunctions) {
      throw new Error("Core not initialized");
    }
    return this.dotnetExportedFunctions.VoicevoxEngineSharp.WasmWeb.SynthesisExports.CreateAccentPhrases(
      text,
      speakerId
    );
  }

  async getMoraData(
    accentPhrasesJson: string,
    speakerId: number
  ): Promise<string> {
    if (!this.dotnetExportedFunctions) {
      throw new Error("Core not initialized");
    }
    return this.dotnetExportedFunctions.VoicevoxEngineSharp.WasmWeb.SynthesisExports.ReplaceMoraData(
      accentPhrasesJson,
      speakerId
    );
  }

  async synthesize(
    audioQueryJson: string,
    speakerId: number
  ): Promise<Uint8Array<ArrayBuffer>> {
    if (!this.dotnetExportedFunctions) {
      throw new Error("Core not initialized");
    }

    const rawAudio /* float32 array */ =
      await this.dotnetExportedFunctions.VoicevoxEngineSharp.WasmWeb.SynthesisExports.SynthesisWave(
        audioQueryJson,
        speakerId
      );

    const byteLength = rawAudio.length * 4;
    const buffer = new ArrayBuffer(44 + byteLength);
    const view = new DataView(buffer);

    // WAVヘッダーを書き込む
    // "RIFF"チャンク
    view.setUint32(0, 0x52494646, false); // "RIFF"
    view.setUint32(4, 36 + byteLength, true); // ファイルサイズ - 8
    view.setUint32(8, 0x57415645, false); // "WAVE"

    // "fmt "サブチャンク
    view.setUint32(12, 0x666d7420, false); // "fmt "
    view.setUint32(16, 16, true); // サブチャンクサイズ
    view.setUint16(20, 3, true); // オーディオフォーマット (3 = IEEE float)
    view.setUint16(22, 1, true); // チャンネル数
    view.setUint32(24, 24000, true); // サンプリングレート
    view.setUint32(28, 24000 * 4, true); // バイトレート
    view.setUint16(32, 4, true); // ブロックサイズ
    view.setUint16(34, 32, true); // ビット深度

    // "data"サブチャンク
    view.setUint32(36, 0x64617461, false); // "data"
    view.setUint32(40, byteLength, true); // データサイズ

    // オーディオデータを書き込む
    for (let i = 0; i < rawAudio.length; i++) {
      view.setFloat32(44 + i * 4, rawAudio[i], true);
    }

    return new Uint8Array(buffer);
  }

  /**
   * yukarinS 推論を ServiceWorker に委譲
   */
  private async proxyYukarinSForward(
    length: number,
    phonemeList: number[],
    speakerId: number[]
  ): Promise<number[]> {
    if (!this.inferenceHandler) {
      throw new Error("Inference handler not set");
    }
    return this.inferenceHandler("yukarinS", {
      length,
      phonemeList,
      speakerId,
    });
  }

  /**
   * yukarinSa 推論を ServiceWorker に委譲
   */
  private async proxyYukarinSaForward(
    length: number,
    vowelPhonemeList: number[],
    consonantPhonemeList: number[],
    startAccentList: number[],
    endAccentList: number[],
    startAccentPhraseList: number[],
    endAccentPhraseList: number[],
    speakerId: number[]
  ): Promise<number[]> {
    if (!this.inferenceHandler) {
      throw new Error("Inference handler not set");
    }
    return this.inferenceHandler("yukarinSa", {
      length,
      vowelPhonemeList,
      consonantPhonemeList,
      startAccentList,
      endAccentList,
      startAccentPhraseList,
      endAccentPhraseList,
      speakerId,
    });
  }

  /**
   * decode 推論を ServiceWorker に委譲
   */
  private async proxyDecodeForward(
    length: number,
    phonemeSize: number,
    f0: number[],
    phoneme: number[],
    speakerId: number[]
  ): Promise<number[]> {
    if (!this.inferenceHandler) {
      throw new Error("Inference handler not set");
    }
    return this.inferenceHandler("decode", {
      length,
      phonemeSize,
      f0,
      phoneme,
      speakerId,
    });
  }
}
