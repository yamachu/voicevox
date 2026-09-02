import { describe, expect, test } from "vitest";
import { resolveStaticUrl } from "@/helpers/baseUrl";

describe("resolveStaticUrl", () => {
  const from = "https://yamachu.github.io/voicevox/";

  test("末尾スラッシュ無しの絶対URLでもデプロイ先のパスを失わない", () => {
    // Vite は base が外部URLかつ build 時の場合、値をそのまま返すため
    // 末尾スラッシュが付かない
    expect(
      resolveStaticUrl(
        "sw-proxy.js",
        "https://yamachu.github.io/voicevox",
        from,
      ),
    ).toBe("https://yamachu.github.io/voicevox/sw-proxy.js");
  });

  test("末尾スラッシュ付きの絶対URLでも同じ結果になる", () => {
    expect(
      resolveStaticUrl(
        "sw-proxy.js",
        "https://yamachu.github.io/voicevox/",
        from,
      ),
    ).toBe("https://yamachu.github.io/voicevox/sw-proxy.js");
  });

  test("ルート配信では配信ルートに解決する", () => {
    expect(resolveStaticUrl("qAndA.md", "/", "https://example.test/")).toBe(
      "https://example.test/qAndA.md",
    );
  });

  test("相対baseでは現在のURLを基準に解決する", () => {
    expect(
      resolveStaticUrl("qAndA.md", "./", "https://example.test/sub/index.html"),
    ).toBe("https://example.test/sub/qAndA.md");
  });

  test("https のスラッシュを潰さない", () => {
    expect(
      resolveStaticUrl("qAndA.md", "https://yamachu.github.io/voicevox", from),
    ).not.toContain("https:/y");
  });
});
