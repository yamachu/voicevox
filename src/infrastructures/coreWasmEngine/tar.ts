/**
 * Open JTalk 辞書の .tar.gz を展開するための最小限の tar リーダー
 *
 * 通常ファイル・ディレクトリ・GNU の長いファイル名のみ扱い、
 * それ以外（シンボリックリンク、pax 拡張ヘッダ等）は読み飛ばす。
 */

const BLOCK_SIZE = 512;
const textDecoder = new TextDecoder();

export type TarEntry = { path: string; data: Uint8Array };

export async function gunzip(
  data: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array> {
  const stream = new Blob([data])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function readString(block: Uint8Array, offset: number, length: number): string {
  const field = block.subarray(offset, offset + length);
  const end = field.indexOf(0);
  return textDecoder.decode(end === -1 ? field : field.subarray(0, end));
}

function readOctal(block: Uint8Array, offset: number, length: number): number {
  const value = readString(block, offset, length).trim();
  return value === "" ? 0 : parseInt(value, 8);
}

/** tar アーカイブ中の通常ファイルを列挙する */
export function* readTar(archive: Uint8Array): Generator<TarEntry> {
  let offset = 0;
  let longName: string | undefined;

  while (offset + BLOCK_SIZE <= archive.length) {
    const header = archive.subarray(offset, offset + BLOCK_SIZE);
    // 終端は 0 埋めのブロック
    if (header.every((byte) => byte === 0)) {
      return;
    }

    const size = readOctal(header, 124, 12);
    const type = String.fromCharCode(header[156]);
    const dataStart = offset + BLOCK_SIZE;
    const data = archive.subarray(dataStart, dataStart + size);
    offset = dataStart + Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;

    if (type === "L") {
      longName = readString(data, 0, data.length);
      continue;
    }

    const prefix =
      readString(header, 257, 6) === "ustar"
        ? readString(header, 345, 155)
        : "";
    const name = readString(header, 0, 100);
    const path = longName ?? (prefix ? `${prefix}/${name}` : name);
    longName = undefined;

    if (type === "0" || type === "\0") {
      yield { path, data };
    }
  }
}
