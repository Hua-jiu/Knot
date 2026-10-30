import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  ApiError,
  FileEntry,
  Host,
  HostInput,
  KeyEntry,
  KeyImport,
  Listing,
  Source,
  Target,
  TransferEvent,
} from "./types";

export function toApiError(e: unknown): ApiError {
  if (e && typeof e === "object" && "code" in e && "message" in e) return e as ApiError;
  return { code: "unknown", message: String(e) };
}

/** Binary channel payloads arrive as ArrayBuffer; older runtimes send number[]. */
export function toBytes(data: ArrayBuffer | number[] | Uint8Array): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return Uint8Array.from(data);
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw toApiError(e);
  }
}

export const api = {
  hostsList: () => call<Host[]>("hosts_list"),
  hostSave: (input: HostInput) => call<Host>("host_save", { input }),
  hostDelete: (id: string) => call<void>("host_delete", { id }),

  keysList: () => call<KeyEntry[]>("keys_list"),
  keyImport: (input: KeyImport) => call<KeyEntry>("key_import", { input }),
  keyGenerate: (label: string, passphrase?: string) => call<KeyEntry>("key_generate", { label, passphrase }),
  keyRename: (id: string, label: string) => call<void>("key_rename", { id, label }),
  keyDelete: (id: string) => call<void>("key_delete", { id }),

  sshconfigImport: () => call<number>("sshconfig_import"),
  hostkeyRespond: (requestId: string, accept: boolean) => call<void>("hostkey_respond", { requestId, accept }),

  termOpen: (
    target: Target,
    cols: number,
    rows: number,
    onData: Channel<ArrayBuffer | number[]>,
    onEvent: Channel<{ type: "exit"; code: number | null }>,
  ) => call<string>("term_open", { target, cols, rows, onData, onEvent }),
  termWrite: (id: string, data: string) => call<void>("term_write", { id, data }),
  termResize: (id: string, cols: number, rows: number) => call<void>("term_resize", { id, cols, rows }),
  termClose: (id: string) => call<void>("term_close", { id }),

  sftpOpen: (target: Target) => call<{ sessionId: string; home: string }>("sftp_open", { target }),
  sftpClose: (sessionId: string) => call<void>("sftp_close", { sessionId }),

  fsHome: (source: Source) => call<string>("fs_home", { source }),
  fsList: (source: Source, path: string, showHidden: boolean) =>
    call<Listing>("fs_list", { source, path, showHidden }),
  fsStat: (source: Source, path: string) => call<FileEntry>("fs_stat", { source, path }),
  fsPreview: async (source: Source, path: string, max?: number) =>
    toBytes(await call<ArrayBuffer | number[]>("fs_preview", { source, path, max })),
  fsMkdir: (source: Source, dir: string, name: string) => call<string>("fs_mkdir", { source, dir, name }),
  fsRename: (source: Source, path: string, newName: string) =>
    call<string>("fs_rename", { source, path, newName }),
  fsMove: (source: Source, paths: string[], dir: string) => call<void>("fs_move", { source, paths, dir }),
  fsDelete: (source: Source, paths: string[]) => call<void>("fs_delete", { source, paths }),
  fsTransfer: (
    from: Source,
    paths: string[],
    to: Source,
    dir: string,
    overwrite: boolean,
    onEvent: Channel<TransferEvent>,
  ) => call<string>("fs_transfer", { from, paths, to, dir, overwrite, onEvent }),
  transferCancel: (id: string) => call<void>("transfer_cancel", { id }),
};
