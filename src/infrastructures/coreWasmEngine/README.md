# wasm 版 VOICEVOX CORE エンジン

`wasm32-unknown-emscripten` 向けにビルドした VOICEVOX CORE（ONNX Runtime を静的リンク済み）を Web Worker で動かし、
エンジンの `DefaultApiInterface` として提供します。HTTP 通信を介さずにブラウザ内で音声合成できます。

エンジンの URL が `wasm://core` のとき、`EngineConnector` がこのエンジンを返します。

## 使い方

`.env` の `VITE_DEFAULT_ENGINE_INFOS` で `host` を `wasm://core` にします。

```
VITE_DEFAULT_ENGINE_INFOS=`[
    {
        "uuid": "a8ef5c5a-6f0a-4d2e-9d6c-0d1f3b1c2e7a",
        "name": "VOICEVOX CORE (wasm)",
        "executionEnabled": false,
        "executionFilePath": "",
        "executionArgs": [],
        "host": "wasm://core"
    }
]`
```

`public/voicevox_core/` に以下を配置します（git 管理外）。

```
public/voicevox_core/
├── wasm_browser_api_example.js     # voicevox_core_wasm のビルド成果物
├── wasm_browser_api_example.wasm
├── open_jtalk_dic_utf_8-1.11.tgz   # Open JTalk 辞書
└── models/
    ├── index.json                  # 読み込む VVM のファイル名の配列。例: ["0.vvm"]
    └── *.vvm
```

Core は `voicevox_core` の `crates/voicevox_core_wasm` を `-sMODULARIZE=1 -sEXPORT_ES6=1` 付きでビルドしたものを使います。
ビルド方法は `example/wasm-experimental/README.md` を参照してください。

## ファイル構成

- `index.ts`
  - `DefaultApiInterface` の実装。Worker とのやり取りと、ENGINE の型への変換を行う
- `worker.ts`
  - Core・辞書・音声モデルを所有し、Core の関数を呼ぶ Worker
- `voicevoxCore.ts`
  - Emscripten の Module のラッパー
- `protocol.ts`
  - メインスレッドと Worker の間のメッセージの型
- `tar.ts`
  - 辞書の `.tgz` を展開する最小限の tar リーダー

## 制限

- 最低限の音声合成に必要な関数のみ実装しています（ソング、モーフィング、ユーザー辞書の編集などは未対応）
- 音声モデルは初期化時にすべて読み込みます
- 立ち絵・アイコン・サンプル音声は VVM に含まれないため、ダミーを返します
