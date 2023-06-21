import { sep } from "path";
import { directoryHandleStoreKey } from "./contract";
import { openDB } from "./store";
import { SandboxKey, WriteFileErrorResult } from "@/type/preload";

const showWritableDirectoryPicker = async (): Promise<
  FileSystemDirectoryHandle | undefined
> =>
  window
    .showDirectoryPicker({
      mode: "readwrite",
    })
    .catch(() => undefined);

const storeDirectoryHandle = async (
  directoryHandle: FileSystemDirectoryHandle
): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(directoryHandleStoreKey, "readwrite");
    const store = transaction.objectStore(directoryHandleStoreKey);
    const request = store.put(directoryHandle, directoryHandle.name);
    request.onsuccess = () => {
      resolve();
    };
    request.onerror = () => {
      reject(request.error);
    };
  });
};

const lastSelectedDirectoryHandleSymbol = Symbol("lastSelectedDirectoryHandle");
const directoryHandleMap: Map<
  string | typeof lastSelectedDirectoryHandleSymbol,
  FileSystemDirectoryHandle
> = new Map();

const updateLatestSelectedDirectoryHandle = (
  handle: FileSystemDirectoryHandle
) => {
  directoryHandleMap.set(lastSelectedDirectoryHandleSymbol, handle);
};

const getLatestSelectedDirectoryHandle = () =>
  directoryHandleMap.get(lastSelectedDirectoryHandleSymbol);

type AcceptFileType = {
  description: string;
  accept: Record<string /** MIME Type */, string[] /** extension */>;
};

const showWritableFilePicker = async ({
  suggestedName,
  fileType,
}: {
  suggestedName?: string;
  fileType: AcceptFileType;
}) =>
  window
    .showSaveFilePicker({
      types: [fileType],
      excludeAcceptAllOption: true,
      suggestedName,
    })
    .catch(() => undefined);

const showLoadableFilePicker = async ({
  fileType,
}: {
  fileType: AcceptFileType;
}) =>
  window
    .showOpenFilePicker({
      types: [fileType],
      excludeAcceptAllOption: true,
      multiple: false,
    })
    .catch(() => undefined);

const requestSaveFileNameWithDirectoryPermission = async ({
  suggestedName,
  fileType,
}: {
  suggestedName?: string;
  fileType: AcceptFileType;
}) => {
  if (directoryHandleMap.get(lastSelectedDirectoryHandleSymbol) === undefined) {
    // Wave File以外のものを同一ディレクトリに保存したり、名前を変えて保存するためにDirectoryのPickerを使用している
    // FIXME: 途中でディレクトリを変えたいとかには対応できない…
    const _directoryHandler = await showWritableDirectoryPicker();
    if (_directoryHandler === undefined) {
      return undefined;
    }

    await storeDirectoryHandle(_directoryHandler).catch((e) =>
      console.error(e)
    );

    updateLatestSelectedDirectoryHandle(_directoryHandler);
  }

  const fileHandle = await showWritableFilePicker({
    suggestedName,
    fileType,
  });
  if (fileHandle === undefined) {
    return undefined;
  }

  // NOTE: ディレクトリのハンドラと異なるディレクトリを選択されても検知できない
  return fileHandle.name;
};

const requestLoadFileNameWithDirectoryPermission = async ({
  fileType,
}: {
  fileType: AcceptFileType;
}) => {
  if (directoryHandleMap.get(lastSelectedDirectoryHandleSymbol) === undefined) {
    // Wave File以外のものを同一ディレクトリに保存したり、名前を変えて保存するためにDirectoryのPickerを使用している
    // FIXME: 途中でディレクトリを変えたいとかには対応できない…
    const _directoryHandler = await showWritableDirectoryPicker();
    if (_directoryHandler === undefined) {
      return undefined;
    }

    await storeDirectoryHandle(_directoryHandler).catch((e) =>
      console.error(e)
    );

    updateLatestSelectedDirectoryHandle(_directoryHandler);
  }

  const fileHandle = await showLoadableFilePicker({
    fileType,
  });
  if (fileHandle === undefined) {
    return undefined;
  }

  // NOTE: ディレクトリのハンドラと異なるディレクトリを選択されても検知できない
  return fileHandle.map((v) => v.name);
};

export const showAudioSaveDialogImpl: typeof window[typeof SandboxKey]["showAudioSaveDialog"] =
  async (obj: { title: string; defaultPath?: string }) => {
    return requestSaveFileNameWithDirectoryPermission({
      suggestedName: obj.defaultPath,
      fileType: { description: "Wave File", accept: { "audio/wav": [".wav"] } },
    });
  };

export const showTextSaveDialogImpl: typeof window[typeof SandboxKey]["showTextSaveDialog"] =
  async (obj: { title: string; defaultPath?: string }) => {
    return requestSaveFileNameWithDirectoryPermission({
      suggestedName: obj.defaultPath,
      fileType: {
        description: "Text File",
        accept: {
          "text/plain": [".txt"],
        },
      },
    });
  };

export const showOpenDirectoryDialogImpl: typeof window[typeof SandboxKey]["showOpenDirectoryDialog"] =
  async () => {
    const _directoryHandler = await showWritableDirectoryPicker();
    if (_directoryHandler === undefined) {
      return undefined;
    }

    await storeDirectoryHandle(_directoryHandler).catch((e) =>
      console.error(e)
    );

    // NOTE: 同一のディレクトリ名だった場合、後で選択されたディレクトリがそれ移行の処理で使用されるため、意図しない保存が発生するかもしれない
    directoryHandleMap.set(_directoryHandler.name, _directoryHandler);
    return _directoryHandler.name;
  };

export const showProjectSaveDialogImpl: typeof window[typeof SandboxKey]["showProjectSaveDialog"] =
  async (obj: { title: string; defaultPath?: string }) => {
    return requestSaveFileNameWithDirectoryPermission({
      suggestedName: obj.defaultPath,
      fileType: {
        description: "VOICEVOX Project file",
        accept: {
          "application/json": [".vvproj"],
        },
      },
    });
  };

export const showProjectLoadDialogImpl: typeof window[typeof SandboxKey]["showProjectLoadDialog"] =
  async () => {
    return requestLoadFileNameWithDirectoryPermission({
      fileType: {
        description: "VOICEVOX Project file",
        accept: {
          "application/json": [".vvproj"],
        },
      },
    });
  };

export const showImportFileDialogImpl: typeof window[typeof SandboxKey]["showImportFileDialog"] =
  async () => {
    return requestLoadFileNameWithDirectoryPermission({
      fileType: {
        description: "Text",
        accept: {
          "text/plain": [".txt"],
        },
      },
    }).then((v) => v?.[0]);
  };

const isRootPathButDirectoryNotSelected = (path: string) =>
  directoryHandleMap.get(lastSelectedDirectoryHandleSymbol) === undefined &&
  path.indexOf(sep) === -1;

const fetchStoredDirectoryHandle = async (maybeDirectoryHandleName: string) => {
  const db = await openDB();
  return new Promise<FileSystemDirectoryHandle | undefined>(
    (resolve, reject) => {
      const transaction = db.transaction(directoryHandleStoreKey, "readonly");
      const store = transaction.objectStore(directoryHandleStoreKey);
      const request = store.get(maybeDirectoryHandleName);
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error);
      };
    }
  ).catch((e) => {
    console.error(e);
    // 握り潰してる
    return undefined;
  });
};

export const writeFileImpl: typeof window[typeof SandboxKey]["writeFile"] =
  async (obj: { filePath: string; buffer: ArrayBuffer }) => {
    if (isRootPathButDirectoryNotSelected(obj.filePath)) {
      return Promise.resolve({
        code: undefined,
        message: "フォルダへのアクセス許可がありません",
      });
    }

    let directoryHandle = getLatestSelectedDirectoryHandle();
    let path = obj.filePath;

    if (path.includes(sep)) {
      const maybeDirectoryHandleName = path.split(sep)[0];
      if (directoryHandleMap.has(maybeDirectoryHandleName)) {
        path = path.slice(maybeDirectoryHandleName.length + sep.length);
        directoryHandle = directoryHandleMap.get(maybeDirectoryHandleName);
      } else {
        // NOTE: fixedDirectoryの場合こっちに落ちる場合がある
        const maybeFixedDirectory = await fetchStoredDirectoryHandle(
          maybeDirectoryHandleName
        );

        if (maybeFixedDirectory === undefined) {
          return Promise.resolve({
            code: undefined,
            message: `フォルダへのアクセス許可がありません。アクセスしようとしたフォルダ名: ${maybeDirectoryHandleName}`,
          });
        }

        if (
          !(await maybeFixedDirectory.requestPermission({ mode: "readwrite" }))
        ) {
          return Promise.resolve({
            code: undefined,
            message:
              "フォルダへのアクセス許可がありません。ファイルの書き込みのために書き込み許可が必要です。",
          });
        }

        directoryHandleMap.set(maybeDirectoryHandleName, maybeFixedDirectory);

        path = path.slice(maybeDirectoryHandleName.length + sep.length);
        directoryHandle = maybeFixedDirectory;
      }
    }

    if (directoryHandle === undefined) {
      return Promise.resolve({
        code: undefined,
        message: "フォルダへのアクセス許可がありません",
      });
    }

    return directoryHandle
      .getFileHandle(path, { create: true })
      .then(async (fileHandle) => {
        const writable = await fileHandle.createWritable();
        await writable.write(obj.buffer);
        return writable.close();
      })
      .then(() => undefined)
      .catch((e) => {
        // FIXME
        console.error(e);
        return {
          code: undefined,
          message: e.message as string,
        } as WriteFileErrorResult;
      });
  };

export const readFileImpl: typeof window[typeof SandboxKey]["readFile"] =
  async (obj: { filePath: string }) => {
    if (isRootPathButDirectoryNotSelected(obj.filePath)) {
      return Promise.reject(new Error("フォルダへのアクセス許可がありません"));
    }

    let directoryHandle = getLatestSelectedDirectoryHandle();
    let path = obj.filePath;

    if (path.includes(sep)) {
      const maybeDirectoryHandleName = path.split(sep)[0];
      if (directoryHandleMap.has(maybeDirectoryHandleName)) {
        path = path.slice(maybeDirectoryHandleName.length + sep.length);
        directoryHandle = directoryHandleMap.get(maybeDirectoryHandleName);
      } else {
        const maybeFixedDirectory = await fetchStoredDirectoryHandle(
          maybeDirectoryHandleName
        );

        if (maybeFixedDirectory === undefined) {
          return Promise.reject(
            new Error(
              `フォルダへのアクセス許可がありません。アクセスしようとしたフォルダ名: ${maybeDirectoryHandleName}`
            )
          );
        }

        if (
          !(await maybeFixedDirectory.requestPermission({ mode: "readwrite" }))
        ) {
          return Promise.reject(
            new Error(
              "フォルダへのアクセス許可がありません。ファイルの読み書きのために許可が必要です。"
            )
          );
        }

        directoryHandleMap.set(maybeDirectoryHandleName, maybeFixedDirectory);

        path = path.slice(maybeDirectoryHandleName.length + sep.length);
        directoryHandle = maybeFixedDirectory;
      }
    }

    if (directoryHandle === undefined) {
      return Promise.reject(new Error("フォルダへのアクセス許可がありません"));
    }

    return directoryHandle.getFileHandle(path).then(async (fileHandle) => {
      const file = await fileHandle.getFile();
      return file.arrayBuffer();
    });
  };

export const checkFileExistsImpl: typeof window[typeof SandboxKey]["checkFileExists"] =
  async (file) => {
    if (isRootPathButDirectoryNotSelected(file)) {
      // FIXME: trueだとloopするはず
      return Promise.resolve(false);
    }

    let directoryHandle = getLatestSelectedDirectoryHandle();
    let path = file;

    if (path.includes(sep)) {
      const maybeDirectoryHandleName = path.split(sep)[0];
      if (directoryHandleMap.has(maybeDirectoryHandleName)) {
        path = path.slice(maybeDirectoryHandleName.length + sep.length);
        directoryHandle = directoryHandleMap.get(maybeDirectoryHandleName);
      } else {
        // NOTE: fixedDirectoryの場合こっちに落ちる場合がある
        const maybeFixedDirectory = await fetchStoredDirectoryHandle(
          maybeDirectoryHandleName
        );

        if (maybeFixedDirectory === undefined) {
          return Promise.resolve(false);
        }

        if (
          !(await maybeFixedDirectory.requestPermission({ mode: "readwrite" }))
        ) {
          return Promise.resolve(false);
        }

        directoryHandleMap.set(maybeDirectoryHandleName, maybeFixedDirectory);

        path = path.slice(maybeDirectoryHandleName.length + sep.length);
        directoryHandle = maybeFixedDirectory;
      }
    }

    if (directoryHandle === undefined) {
      // FIXME: trueだとloopするはず
      return Promise.resolve(false);
    }

    const fileEntries = [];
    for await (const [
      fileOrDirectoryName,
      entry,
    ] of directoryHandle.entries()) {
      if (entry.kind === "file") {
        fileEntries.push(fileOrDirectoryName);
      }
    }

    return Promise.resolve(fileEntries.includes(path));
  };