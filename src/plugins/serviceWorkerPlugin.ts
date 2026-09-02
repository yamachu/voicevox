import { type Plugin } from "vue";
import { createLogger } from "@/helpers/log";

const logger = createLogger("serviceWorkerPlugin");

export const serviceWorkerPlugin: Plugin = {
  install() {
    if (
      import.meta.env.VITE_TARGET !== "browser" ||
      import.meta.env.VITE_ENABLE_SERVICE_WORKER !== "true"
    ) {
      return;
    }
    if (!("serviceWorker" in navigator)) {
      logger.warn("Service Worker is not supported in this browser.");
      return;
    }
    // BASE_URL は "/" のようなパスにも "https://example.github.io/voicevox/" のような
    // 絶対URLにもなり得るため、location を基準に解決する
    const swProxyUrl = new URL(
      "sw-proxy.js",
      new URL(import.meta.env.BASE_URL || "/", location.href),
    ).href;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    void import(
      /* @vite-ignore */ swProxyUrl
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    ).then((v) => v.registerServiceWorkerWithProxy());
  },
};
