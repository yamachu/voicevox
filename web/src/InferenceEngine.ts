/**
 * 推論エンジン
 * ONNX Runtime によるニューラルネットワーク推論 / セッション管理を行う
 *
 * DedicatedWorker 内で生成される想定。Web Worker そのものではない。
 */
import {
  decodeForward,
  yukarinSForward,
  yukarinSaForward,
} from "@voicevoxenginesharp-wasm-web/inference";
import { env, InferenceSession } from "onnxruntime-web";

type SpeakerOnnxSessions = Map<string /* ONNX File Name */, InferenceSession>;
type ModelType = "yukarinS" | "yukarinSa" | "spectrogram" | "vocoder";

const modelTypes = [
  "yukarinS",
  "yukarinSa",
  "spectrogram",
  "vocoder",
] as const satisfies ModelType[];

export class InferenceEngine {
  private sessions: Record<ModelType, SpeakerOnnxSessions>;
  private initializingModels: Map<string, Promise<InferenceSession>> =
    new Map();
  private readonly assetBaseUrl: string;

  /**
   * @param assetBaseUrl models/ を含む末尾 "/" 付きの絶対URL
   */
  constructor(assetBaseUrl: string) {
    this.assetBaseUrl = assetBaseUrl;

    // 非 bundle 版の onnxruntime-web は glue と wasm を実行時に取得する。
    // GitHub Pages のサブパス配信でも解決できるよう明示的に指定する
    env.wasm.wasmPaths = assetBaseUrl;

    this.sessions = {
      yukarinS: new Map(),
      yukarinSa: new Map(),
      spectrogram: new Map(),
      vocoder: new Map(),
    };
  }

  // NOTE: 現状モデルは一つしかないので、全部同じ所に向ける
  private modelPaths(_speakerId: number): Record<ModelType, string> {
    const resolve = (path: string) => new URL(path, this.assetBaseUrl).href;
    return {
      yukarinS: resolve("models/duration.onnx"),
      yukarinSa: resolve("models/intonation.onnx"),
      spectrogram: resolve("models/spectrogram.onnx"),
      vocoder: resolve("models/vocoder.onnx"),
    };
  }

  /**
   * 利用可能な Execution Provider
   * WebGPU が露出していない実行環境（ServiceWorker など）では wasm のみになる
   */
  private static executionProviders(): ("webgpu" | "wasm")[] {
    return "gpu" in navigator ? ["webgpu", "wasm"] : ["wasm"];
  }

  /**
   * セッションを生成する。同一モデルへの同時要求は1つの Promise に束ねる
   */
  private async createSession(
    modelType: ModelType,
    modelPath: string
  ): Promise<InferenceSession> {
    const sessionMap = this.sessions[modelType];

    const cached = sessionMap.get(modelPath);
    if (cached) {
      return cached;
    }

    const initKey = `${modelType}:${modelPath}`;
    const existingInit = this.initializingModels.get(initKey);
    if (existingInit) {
      return existingInit;
    }

    const executionProviders = InferenceEngine.executionProviders();
    const initPromise = (async () => {
      console.log(
        `[InferenceEngine] Loading model: ${modelPath} (${executionProviders.join(", ")})`
      );
      try {
        const session = await InferenceSession.create(modelPath, {
          executionProviders,
        });
        sessionMap.set(modelPath, session);
        console.log(`[InferenceEngine] Loaded model: ${modelPath}`);
        return session;
      } catch (error) {
        throw new Error(
          `Failed to create ONNX session for ${modelType} (${modelPath}): ${
            error instanceof Error ? error.message : String(error)
          }`,
          { cause: error }
        );
      }
    })();

    this.initializingModels.set(initKey, initPromise);
    try {
      return await initPromise;
    } finally {
      this.initializingModels.delete(initKey);
    }
  }

  sessionInitialized(speakerId: number): boolean {
    return modelTypes.every((modelType) => {
      const sessionMap = this.sessions[modelType];
      const modelPath = this.modelPaths(speakerId)[modelType];
      return sessionMap.has(modelPath);
    });
  }

  async initializeSession(speakerId: number): Promise<void> {
    const modelPaths = this.modelPaths(speakerId);
    await Promise.all(
      modelTypes.map((modelType) =>
        this.createSession(modelType, modelPaths[modelType])
      )
    );
  }

  private async getSession(
    modelType: ModelType,
    speakerId: number
  ): Promise<InferenceSession> {
    // 遅延初期化も createSession に任せ、重複生成を防ぐ
    return this.createSession(modelType, this.modelPaths(speakerId)[modelType]);
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
