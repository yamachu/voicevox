import { Plugin } from "vue";
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    void import(/* @vite-ignore */ `${location.origin}/sw-proxy.js`).then((v) =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, prettier/prettier
      v.registerServiceWorkerWithProxy()
    );
  },
};
