import { Configuration, DefaultApi } from "@/openapi";
import { EngineInterface } from "@/store/type";

type EngineInstanceParameter = { type: "openapi"; host: string };

export interface IEngineConnectorFactory {
  // FIXME: hostという名前の時点で外部APIに接続するという知識が出てきてしまっているので
  // Factory自体に型パラメータを付けて、接続方法だったり設定、IDみたいな名前で表現する
  instance: (param: EngineInstanceParameter) => EngineInterface;
}

const OpenAPIEngineConnectorFactoryImpl = (): IEngineConnectorFactory => {
  const instanceMapper: Record<string, EngineInterface> = {};
  return {
    instance: (param: EngineInstanceParameter) => {
      const { host } = param;
      const cached = instanceMapper[host];
      if (cached !== undefined) {
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
