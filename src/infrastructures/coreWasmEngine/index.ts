/**
 * wasm版のVOICEVOX COREをWorkerで動かし、エンジンのOpenAPIの関数群として提供する。
 * HTTP通信を介さずにブラウザ内で音声合成できる。
 *
 * 最低限の音声合成に必要な関数のみ実装している。
 */

import type { CoreWasmCommands, CoreWasmResponse } from "./protocol";
import type { CharacterMeta } from "./voicevoxCore";
import {
  AccentPhraseFromJSON,
  AccentPhraseToJSON,
  AudioQueryFromJSON,
  AudioQueryToJSON,
  SpeakerFromJSON,
  type AccentPhrase,
  type AccentPhrasesRequest,
  type AudioQuery,
  type AudioQueryRequest,
  type DefaultApiInterface,
  type EngineManifest,
  type InitializeSpeakerRequest,
  type IsInitializedSpeakerRequest,
  type MoraDataRequest,
  type Speaker,
  type SpeakerInfo,
  type SpeakerInfoRequest,
  type SupportedDevicesInfo,
  type SynthesisRequest,
  type UserDictWord,
} from "@/openapi";

/** 1pxの画像。VVMには立ち絵やアイコンが含まれないため代わりに使う */
const dummyImage =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAA1JREFUGFdjWHpl7X8AB24DJsTeKbEAAAAASUVORK5CYII=";

function getEngineManifest(): EngineManifest {
  return {
    manifestVersion: "0.13.1",
    name: "VOICEVOX CORE (wasm)",
    brandName: "VOICEVOX",
    uuid: "a8ef5c5a-6f0a-4d2e-9d6c-0d1f3b1c2e7a",
    url: "https://github.com/VOICEVOX/voicevox_core",
    icon: dummyImage,
    defaultSamplingRate: 24000,
    frameRate: 93.75,
    termsOfService: "",
    updateInfos: [],
    dependencyLicenses: [],
    supportedVvlibManifestVersion: undefined,
    supportedFeatures: {
      adjustMoraPitch: true,
      adjustPhonemeLength: true,
      adjustSpeedScale: true,
      adjustPitchScale: true,
      adjustIntonationScale: true,
      adjustVolumeScale: true,
      // COREのAudioQueryには無い
      adjustPauseLength: false,
      interrogativeUpspeak: true,
      synthesisMorphing: false,
      sing: false,
      manageLibrary: false,
      returnResourceUrl: false,
    },
  };
}

/** Core・辞書・音声モデルを置くディレクトリ */
function getAssetBaseUrl(): string {
  return new URL(
    `${import.meta.env.BASE_URL}voicevox_core/`,
    window.location.href,
  ).href;
}

/** Workerとのやり取りを行うクライアント */
function createWorkerClient() {
  let worker: Worker | undefined;
  let nextId = 0;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
  >();

  const failAll = (reason: string) => {
    for (const { reject } of pending.values()) {
      reject(new Error(reason));
    }
    pending.clear();
  };

  const ensureWorker = (): Worker => {
    if (worker != undefined) {
      return worker;
    }
    const newWorker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    newWorker.addEventListener(
      "message",
      (event: MessageEvent<CoreWasmResponse>) => {
        const response = event.data;
        const callbacks = pending.get(response.id);
        if (callbacks == undefined) return;
        pending.delete(response.id);
        if (response.success) {
          callbacks.resolve(response.data);
        } else {
          callbacks.reject(new Error(response.error));
        }
      },
    );
    // Workerが落ちた場合は作り直せるように破棄する
    newWorker.addEventListener("error", (event) => {
      newWorker.terminate();
      worker = undefined;
      failAll(`Core wasm worker error: ${event.message}`);
    });
    worker = newWorker;
    return newWorker;
  };

  const call = <C extends keyof CoreWasmCommands>(
    command: C,
    data: CoreWasmCommands[C]["request"],
  ): Promise<CoreWasmCommands[C]["response"]> => {
    const target = ensureWorker();
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      target.postMessage({ id, command, data });
    });
  };

  // 初期化は重いので一度だけ行い、他のコマンドはその完了を待つ
  let initializePromise: Promise<void> | undefined;
  const ensureInitialized = (): Promise<void> => {
    if (initializePromise == undefined) {
      initializePromise = call("initialize", {
        assetBaseUrl: getAssetBaseUrl(),
      });
      initializePromise.catch(() => {
        initializePromise = undefined;
      });
    }
    return initializePromise;
  };

  return {
    async invoke<C extends Exclude<keyof CoreWasmCommands, "initialize">>(
      command: C,
      data: CoreWasmCommands[C]["request"],
    ): Promise<CoreWasmCommands[C]["response"]> {
      await ensureInitialized();
      return call(command, data);
    },
    ensureInitialized,
  };
}

/** COREのメタ情報からトーク用のキャラクター情報を作る */
function toSpeakers(metas: CharacterMeta[]): Speaker[] {
  return metas
    .map((character) =>
      SpeakerFromJSON({
        name: character.name,
        speaker_uuid: character.speaker_uuid,
        styles: character.styles
          .filter((style) => style.type === "talk")
          .map(({ name, id, type }) => ({ name, id, type })),
        version: character.version,
        supported_features: { permitted_synthesis_morphing: "NOTHING" },
      }),
    )
    .filter((speaker) => speaker.styles.length > 0);
}

export function createOpenAPICoreWasmEngine(): DefaultApiInterface {
  const client = createWorkerClient();

  const api: Partial<DefaultApiInterface> = {
    async version(): Promise<string> {
      await client.ensureInitialized();
      return "core-wasm";
    },

    // メタ情報
    async engineManifest(): Promise<EngineManifest> {
      return getEngineManifest();
    },

    async supportedDevices(): Promise<SupportedDevicesInfo> {
      return { cpu: true, cuda: false, dml: false };
    },

    // キャラクター情報
    async speakers(): Promise<Speaker[]> {
      return toSpeakers(await client.invoke("metas", undefined));
    },

    async speakerInfo(payload: SpeakerInfoRequest): Promise<SpeakerInfo> {
      const metas = await client.invoke("metas", undefined);
      const character = metas.find(
        (meta) => meta.speaker_uuid === payload.speakerUuid,
      );
      if (character == undefined) {
        throw new Error(`Speaker ${payload.speakerUuid} is not found`);
      }
      return {
        policy: "",
        portrait: dummyImage,
        styleInfos: character.styles.map((style) => ({
          id: style.id,
          icon: dummyImage,
          voiceSamples: [],
        })),
      };
    },

    // 音声モデルは初期化時にすべて読み込むため、読み込み済みかどうかだけを返す
    async isInitializedSpeaker(
      payload: IsInitializedSpeakerRequest,
    ): Promise<boolean> {
      return client.invoke("isLoadedStyle", { styleId: payload.speaker });
    },

    async initializeSpeaker(payload: InitializeSpeakerRequest): Promise<void> {
      if (
        !(await client.invoke("isLoadedStyle", { styleId: payload.speaker }))
      ) {
        throw new Error(`Style ${payload.speaker} is not found`);
      }
    },

    // トーク系
    async audioQuery(payload: AudioQueryRequest): Promise<AudioQuery> {
      const json = await client.invoke("audioQuery", {
        text: payload.text,
        styleId: payload.speaker,
      });
      return AudioQueryFromJSON(JSON.parse(json));
    },

    async accentPhrases(
      payload: AccentPhrasesRequest,
    ): Promise<AccentPhrase[]> {
      const json = await client.invoke("accentPhrases", {
        text: payload.text,
        isKana: payload.isKana ?? false,
        styleId: payload.speaker,
      });
      return (JSON.parse(json) as unknown[]).map(AccentPhraseFromJSON);
    },

    async moraData(payload: MoraDataRequest): Promise<AccentPhrase[]> {
      const json = await client.invoke("moraData", {
        accentPhrasesJson: JSON.stringify(
          payload.accentPhrase.map(AccentPhraseToJSON),
        ),
        styleId: payload.speaker,
      });
      return (JSON.parse(json) as unknown[]).map(AccentPhraseFromJSON);
    },

    async synthesis(payload: SynthesisRequest): Promise<Blob> {
      const wav = await client.invoke("synthesis", {
        audioQueryJson: JSON.stringify(AudioQueryToJSON(payload.audioQuery)),
        styleId: payload.speaker,
        enableInterrogativeUpspeak: payload.enableInterrogativeUpspeak ?? true,
      });
      return new Blob([wav], { type: "audio/wav" });
    },

    // 辞書系。ユーザー辞書は未対応なので常に空を返す
    async getUserDictWords(): Promise<{ [key: string]: UserDictWord }> {
      return {};
    },
  };

  return api satisfies Partial<DefaultApiInterface> as DefaultApiInterface;
}
