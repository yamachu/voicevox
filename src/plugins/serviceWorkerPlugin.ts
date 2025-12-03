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
    void navigator.serviceWorker
      .getRegistrations()
      .then(function (registrations) {
        for (const registration of registrations) {
          logger.info("Unregister Service Worker");
          void registration.unregister();
        }
        return navigator.serviceWorker
          .register("/sw.js", {
            scope: "/",
            type: "module",
            updateViaCache: "none",
          })
          .then((registration) => {
            logger.info(
              "Service Worker registered with scope:",
              registration.scope,
            );
          })
          .catch((error) => {
            logger.error("Service Worker registration failed:", error);
          });
      });
  },
};
