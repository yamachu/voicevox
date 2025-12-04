import { initialize } from "@voicevoxenginesharp-wasm-web/core";
import {
  decodeForward,
  yukarinSForward,
  yukarinSaForward,
} from "@voicevoxenginesharp-wasm-web/inference";
import { InferenceSession } from "onnxruntime-web";

type SpeakerOnnxSessions = Map<string /* ONNX File Name */, InferenceSession>;
type ModelType = "yukarinS" | "yukarinSa" | "spectrogram" | "vocoder";

export class Engine {
  private isInitialized: boolean = false;
  private initializeInProgress: boolean = false;
  private sessions: Record<ModelType, SpeakerOnnxSessions>;
  private dotnetExportedFunctions: Awaited<
    ReturnType<typeof initialize>
  > | null = null;

  constructor() {
    this.sessions = {
      yukarinS: new Map(),
      yukarinSa: new Map(),
      spectrogram: new Map(),
      vocoder: new Map(),
    };

    this.sessionInjectedYukarinSForward =
      this.sessionInjectedYukarinSForward.bind(this);
    this.sessionInjectedYukarinSaForward =
      this.sessionInjectedYukarinSaForward.bind(this);
    this.sessionInjectedDecodeForward =
      this.sessionInjectedDecodeForward.bind(this);
  }

  async initializeCore(openJTalkDictArray: Uint8Array): Promise<void> {
    if (this.initializeInProgress) {
      return Promise.reject(new Error("Initialization already in progress"));
    }
    if (this.isInitialized) {
      return Promise.resolve();
    }
    this.initializeInProgress = true;

    const exportedFunction = await initialize(
      {
        decodeForward: this.sessionInjectedDecodeForward,
        yukarinSForward: this.sessionInjectedYukarinSForward,
        yukarinSaForward: this.sessionInjectedYukarinSaForward,
      },
      {
        diagnosticTracing: false,
      }
    );

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

  sessionInitialized(speakerId: number): boolean {
    return (
      [
        "yukarinS",
        "yukarinSa",
        "spectrogram",
        "vocoder",
      ] as const satisfies ModelType[]
    ).every((modelType) => {
      const sessionMap = this.sessions[modelType as ModelType];
      const modelPath = this.modelPaths(speakerId)[modelType];
      return sessionMap.has(modelPath);
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
    // float32 array
    const rawAudio =
      await this.dotnetExportedFunctions.VoicevoxEngineSharp.WasmWeb.SynthesisExports.SynthesisWave(
        audioQueryJson,
        speakerId
      );

    // float32 array to Uint8Array<ArrayBuffer> that treat as float32 WAV, return 'audio/wav'
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

  private modelPaths(speakerId: number): Record<ModelType, string> {
    return {
      yukarinS: `./models/duration.onnx`,
      yukarinSa: `./models/intonation.onnx`,
      spectrogram: `./models/spectrogram.onnx`,
      vocoder: `./models/vocoder.onnx`,
    };
  }

  async initializeSession(speakerId: number): Promise<void> {
    return Promise.all(
      (
        [
          "yukarinS",
          "yukarinSa",
          "spectrogram",
          "vocoder",
        ] as const satisfies ModelType[]
      ).map(async (modelType) => {
        const sessionMap = this.sessions[modelType];
        const modelPath = this.modelPaths(speakerId)[modelType];
        const maybeSession = sessionMap.get(modelPath);
        if (maybeSession) {
          return;
        }

        const session = await InferenceSession.create(modelPath, {
          executionProviders: ["webgpu", "wasm"],
        });
        sessionMap.set(modelPath, session);
        return;
      })
    ).then(() => {});
  }

  private async getSession(
    modelType: ModelType,
    speakerId: number
  ): Promise<InferenceSession> {
    const sessionMap = this.sessions[modelType];
    const modelPath = this.modelPaths(speakerId)[modelType];
    const maybeSession = sessionMap.get(modelPath);
    if (maybeSession) {
      return maybeSession;
    }

    const session = await InferenceSession.create(modelPath, {
      executionProviders: ["webgpu", "wasm"],
    });
    sessionMap.set(modelPath, session);

    return session;
  }

  private async sessionInjectedYukarinSForward(
    length: number,
    phonemeList: number[],
    speakerId: number[]
  ): Promise<number[]> {
    return this.getSession("yukarinS", speakerId[0]).then((session) =>
      yukarinSForward(session, length, phonemeList, speakerId)
    );
  }

  private async sessionInjectedYukarinSaForward(
    length: number,
    vowelPhonemeList: number[],
    consonantPhonemeList: number[],
    startAccentList: number[],
    endAccentList: number[],
    startAccentPhraseList: number[],
    endAccentPhraseList: number[],
    speakerId: number[]
  ): Promise<number[]> {
    return this.getSession("yukarinSa", speakerId[0]).then((session) =>
      yukarinSaForward(
        session,
        length,
        vowelPhonemeList,
        consonantPhonemeList,
        startAccentList,
        endAccentList,
        startAccentPhraseList,
        endAccentPhraseList,
        speakerId
      )
    );
  }

  private async sessionInjectedDecodeForward(
    length: number,
    phonemeSize: number,
    f0: number[],
    phoneme: number[],
    speakerId: number[]
  ): Promise<number[]> {
    return Promise.all([
      this.getSession("spectrogram", speakerId[0]),
      this.getSession("vocoder", speakerId[0]),
    ]).then(([spectrogramSession, vocoderSession]) =>
      decodeForward(
        spectrogramSession,
        vocoderSession,
        length,
        phonemeSize,
        f0,
        phoneme,
        speakerId
      )
    );
  }
}
