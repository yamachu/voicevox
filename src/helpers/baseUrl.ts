/**
 * BASE_URL を基準に静的ファイルのURLを解決する
 *
 * `import.meta.env.BASE_URL` は `--base` の指定次第で以下のいずれにもなる。
 *
 * - `/`（既定）
 * - `./`（プレビュービルド）
 * - `https://example.github.io/voicevox`（GitHub Pages）
 *
 * Vite の `resolveBaseUrl` は base が外部URLかつ build 時の場合、値をそのまま
 * 返すため末尾スラッシュが保証されない。これを基準に相対解決すると最後の
 * セグメントが置換され、`https://example.github.io/sw-proxy.js` のように
 * デプロイ先のパスを失う。そのため補ってから解決する。
 *
 * @param relativePath 配信ルート直下のファイル名
 * @param base 既定は `import.meta.env.BASE_URL`。テスト用に差し替えられる
 * @param from base が相対パスの場合の解決基準。既定は現在のURL
 */
export function resolveStaticUrl(
  relativePath: string,
  base: string = import.meta.env.BASE_URL || "/",
  from: string = location.href,
): string {
  const baseUrl = new URL(base, from);
  if (!baseUrl.pathname.endsWith("/")) {
    baseUrl.pathname += "/";
  }
  return new URL(relativePath, baseUrl).href;
}
