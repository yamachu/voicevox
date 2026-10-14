import { createEngineUrl, type EngineUrlParams } from "@/domain/url";
import { createOpenAPIEngineMock } from "@/mock/engineMock";
import { createOpenAPICoreWasmEngine } from "@/infrastructures/coreWasmEngine";
import { Configuration, DefaultApi, type DefaultApiInterface } from "@/openapi";

export interface IEngineConnectorFactory {
  // FIXME: hostという名前の時点で外部APIに接続するという知識が出てきてしまっているので
  // Factory自体に型パラメータを付けて、接続方法だったり設定、IDみたいな名前で表現する
  instance: (host: string) => DefaultApiInterface;
}

// 通常エンジン
const OpenAPIEngineConnectorFactoryImpl = (): IEngineConnectorFactory => {
  const instanceMapper: Record<string, DefaultApiInterface> = {};
  return {
    instance: (host: string) => {
      const cached = instanceMapper[host];
      if (cached != undefined) {
        return cached;
      }
      const api = new DefaultApi(new Configuration({ basePath: host }));
      instanceMapper[host] = api;

      return api;
    },
  };
};
export const OpenAPIEngineConnectorFactory =
  OpenAPIEngineConnectorFactoryImpl();

// モック用エンジン
const OpenAPIMockEngineConnectorFactoryImpl = (): IEngineConnectorFactory => {
  let mockInstance: DefaultApiInterface | undefined;
  return {
    instance: () => {
      if (!mockInstance) {
        mockInstance = createOpenAPIEngineMock();
      }
      return mockInstance;
    },
  };
};
export const OpenAPIMockEngineConnectorFactory =
  OpenAPIMockEngineConnectorFactoryImpl();

// wasm版のVOICEVOX COREを使うエンジン
const OpenAPICoreWasmEngineConnectorFactoryImpl =
  (): IEngineConnectorFactory => {
    let coreWasmInstance: DefaultApiInterface | undefined;
    return {
      instance: () => {
        if (!coreWasmInstance) {
          coreWasmInstance = createOpenAPICoreWasmEngine();
        }
        return coreWasmInstance;
      },
    };
  };
export const OpenAPICoreWasmEngineConnectorFactory =
  OpenAPICoreWasmEngineConnectorFactoryImpl();

// 通常エンジンとモック用エンジンとwasm版COREの対応
// モック用エンジンのURLのときはモックを、wasm版COREのURLのときはwasm版COREを、
// そうじゃないときは通常エンジンを返す。
const OpenAPIEngineAndMockConnectorFactoryImpl =
  (): IEngineConnectorFactory => {
    // モック用エンジンのURLは `mock://mock` とする
    const mockUrlParams: EngineUrlParams = {
      protocol: "mock:",
      hostname: "mock",
      port: "",
      pathname: "",
    };
    // wasm版COREのURLは `wasm://core` とする
    const coreWasmUrlParams: EngineUrlParams = {
      protocol: "wasm:",
      hostname: "core",
      port: "",
      pathname: "",
    };

    return {
      instance: (host: string) => {
        if (host == createEngineUrl(mockUrlParams)) {
          return OpenAPIMockEngineConnectorFactory.instance(host);
        } else if (host == createEngineUrl(coreWasmUrlParams)) {
          return OpenAPICoreWasmEngineConnectorFactory.instance(host);
        } else {
          return OpenAPIEngineConnectorFactory.instance(host);
        }
      },
    };
  };
export const OpenAPIEngineAndMockConnectorFactory =
  OpenAPIEngineAndMockConnectorFactoryImpl();
