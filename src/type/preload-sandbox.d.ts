import { MainWorldAPIKey } from "@/type/preload";

declare global {
  interface Window {
    readonly [MainWorldAPIKey]: import("@/type/preload").Sandbox;
  }
}
