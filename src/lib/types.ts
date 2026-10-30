export interface Host {
  id: string;
  label: string;
  hostname: string;
  port: number;
  username: string;
  keyId: string | null;
  hasPassword: boolean;
  os: string | null;
  createdAt: number;
  lastUsed: number | null;
}

export interface HostInput {
  id?: string;
  label: string;
  hostname: string;
  port: number;
  username: string;
  keyId: string | null;
  /** undefined keeps the stored password, "" removes it. */
  password?: string;
}

export interface KeyEntry {
  id: string;
  label: string;
  algorithm: string;
  fingerprint: string;
  publicKey: string;
  encrypted: boolean;
  hasPassphrase: boolean;
  path: string;
  managed: boolean;
  createdAt: number;
}

export interface KeyImport {
  label: string;
  privateKey?: string;
  path?: string;
  passphrase?: string;
}

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number;
  modified: number | null;
  permissions: string | null;
}

export interface Listing {
  path: string;
  parent: string | null;
  segments: { name: string; path: string }[];
  entries: FileEntry[];
}

export type Source = { kind: "local" } | { kind: "remote"; sessionId: string };

export type Target =
  | { kind: "local" }
  | { kind: "saved"; hostId: string; password?: string }
  | { kind: "adhoc"; hostname: string; port: number; username: string; password?: string };

export interface ApiError {
  code: string;
  message: string;
}

export interface Progress {
  bytesDone: number;
  bytesTotal: number;
  filesDone: number;
  filesTotal: number;
  current: string;
}

export type TransferEvent =
  | ({ type: "progress" } & Progress)
  | { type: "done" }
  | { type: "failed"; error: ApiError };

export interface HostKeyInfo {
  host: string;
  port: number;
  algorithm: string;
  fingerprint: string;
}
