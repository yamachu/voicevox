declare global {
  interface Window {
    readonly electron: import("@/type/preload").Sandbox;
  }
}
