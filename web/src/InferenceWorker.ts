/**
 * ServiceWorker 用推論エンジン
 * ONNX Runtime によるニューラルネットワーク推論 / セッション管理を行う
 */
import {
  decodeForward,
  yukarinSForward,
  yukarinSaForward,
} from "@voicevoxenginesharp-wasm-web/inference";
import { InferenceSession } from "onnxruntime-web";

type SpeakerOnnxSessions = Map<string /* ONNX File Name */, InferenceSession>;
type ModelType = "yukarinS" | "yukarinSa" | "spectrogram" | "vocoder";

const modelTypes = [
  "yukarinS",
  "yukarinSa",
  "spectrogram",
  "vocoder",
] as const satisfies ModelType[];

export class InferenceWorker {
  private sessions: Record<ModelType, SpeakerOnnxSessions>;
  private initializingModels: Map<string, Promise<void>> = new Map();

  constructor() {
    this.sessions = {
      yukarinS: new Map(),
      yukarinSa: new Map(),
      spectrogram: new Map(),
      vocoder: new Map(),
    };
  }

  // NOTE: 現状モデルは一つしかないので、全部同じ所に向ける
  private modelPaths(_speakerId: number): Record<ModelType, string> {
    return {
      yukarinS: `./models/duration.onnx`,
      yukarinSa: `./models/intonation.onnx`,
      spectrogram: `./models/spectrogram.onnx`,
      vocoder: `./models/vocoder.onnx`,
    };
  }

  sessionInitialized(speakerId: number): boolean {
    return modelTypes.every((modelType) => {
      const sessionMap = this.sessions[modelType];
      const modelPath = this.modelPaths(speakerId)[modelType];
      return sessionMap.has(modelPath);
    });
  }

  async initializeSession(speakerId: number): Promise<void> {
    await Promise.all(
      modelTypes.map(async (modelType) => {
        const sessionMap = this.sessions[modelType];
        const modelPath = this.modelPaths(speakerId)[modelType];

        // 既に初期化済み
        if (sessionMap.has(modelPath)) {
          return;
        }

        // 初期化中の場合は待機
        const initKey = `${modelType}:${modelPath}`;
        const existingInit = this.initializingModels.get(initKey);
        if (existingInit) {
          await existingInit;
          return;
        }

        // 新規初期化
        const initPromise = (async () => {
          console.log(`[InferenceWorker] Loading model: ${modelPath}`);
          const session = await InferenceSession.create(modelPath, {
            executionProviders: ["webgpu", "wasm"],
          });
          sessionMap.set(modelPath, session);
          console.log(`[InferenceWorker] Loaded model: ${modelPath}`);
        })();

        this.initializingModels.set(initKey, initPromise);

        try {
          await initPromise;
        } finally {
          this.initializingModels.delete(initKey);
        }
      })
    );
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

    // 遅延初期化
    const initKey = `${modelType}:${modelPath}`;
    const existingInit = this.initializingModels.get(initKey);
    if (existingInit) {
      await existingInit;
      return sessionMap.get(modelPath)!;
    }

    const session = await InferenceSession.create(modelPath, {
      executionProviders: ["webgpu", "wasm"],
    });
    sessionMap.set(modelPath, session);

    return session;
  }

  async yukarinSForward(
    length: number,
    phonemeList: number[],
    speakerId: number[]
  ): Promise<number[]> {
    const session = await this.getSession("yukarinS", speakerId[0]);
    return yukarinSForward(session, length, phonemeList, speakerId);
  }

  async yukarinSaForward(
    length: number,
    vowelPhonemeList: number[],
    consonantPhonemeList: number[],
    startAccentList: number[],
    endAccentList: number[],
    startAccentPhraseList: number[],
    endAccentPhraseList: number[],
    speakerId: number[]
  ): Promise<number[]> {
    const session = await this.getSession("yukarinSa", speakerId[0]);
    return yukarinSaForward(
      session,
      length,
      vowelPhonemeList,
      consonantPhonemeList,
      startAccentList,
      endAccentList,
      startAccentPhraseList,
      endAccentPhraseList,
      speakerId
    );
  }

  async decodeForward(
    length: number,
    phonemeSize: number,
    f0: number[],
    phoneme: number[],
    speakerId: number[]
  ): Promise<number[]> {
    const [spectrogramSession, vocoderSession] = await Promise.all([
      this.getSession("spectrogram", speakerId[0]),
      this.getSession("vocoder", speakerId[0]),
    ]);
    return decodeForward(
      spectrogramSession,
      vocoderSession,
      length,
      phonemeSize,
      f0,
      phoneme,
      speakerId
    );
  }
}
