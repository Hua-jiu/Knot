import type { FileEntry } from "./types";

export const isMac = navigator.userAgent.includes("Mac");

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

const dateFmt = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function formatDate(unixSecs: number | null): string {
  return unixSecs == null ? "--" : dateFmt.format(new Date(unixSecs * 1000));
}

export function extension(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

const KINDS: Record<string, string> = {
  png: "PNG image", jpg: "JPEG image", jpeg: "JPEG image", gif: "GIF image", webp: "WebP image",
  svg: "SVG image", bmp: "BMP image", ico: "Icon", heic: "HEIC image",
  txt: "text", md: "Markdown", log: "log", json: "JSON", yaml: "YAML", yml: "YAML", toml: "TOML",
  xml: "XML", csv: "CSV", html: "HTML", css: "CSS", js: "JavaScript", ts: "TypeScript", tsx: "TypeScript",
  py: "Python", rs: "Rust", go: "Go", c: "C source", h: "C header", cpp: "C++", java: "Java", sh: "shell script",
  zip: "ZIP archive", gz: "gzip archive", tgz: "tar.gz archive", tar: "tar archive", xz: "xz archive",
  pdf: "PDF", dmg: "disk image", iso: "disk image", mp4: "MPEG-4 movie", mov: "QuickTime movie", mp3: "MP3 audio",
};

export function kindOf(e: FileEntry): string {
  if (e.isSymlink) return "link";
  if (e.isDir) return "folder";
  const ext = extension(e.name);
  return KINDS[ext] ?? (ext ? `${ext.toUpperCase()} file` : "file");
}

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"]);
const IMAGE_MIME: Record<string, string> = { svg: "image/svg+xml", jpg: "image/jpeg", ico: "image/x-icon" };

export function imageMime(name: string): string | null {
  const ext = extension(name);
  return IMAGE_EXT.has(ext) ? (IMAGE_MIME[ext] ?? `image/${ext}`) : null;
}

/** Heuristic: no NULs and mostly printable in the first chunk. */
export function looksLikeText(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8192);
  let odd = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 0) return false;
    if (b < 7 || (b > 13 && b < 32)) odd++;
  }
  return n === 0 || odd / n < 0.05;
}

/** Parse quick-connect input: `user@host`, `user@host:2222`, `ssh -p 2222 user@host`. */
export function parseSshTarget(input: string): { username: string; hostname: string; port: number } | null {
  let s = input.trim();
  if (!s) return null;
  let port = 22;
  s = s.replace(/^ssh\s+/, "");
  const p = s.match(/(?:^|\s)-p\s*(\d+)/);
  if (p) {
    port = Number(p[1]);
    s = s.replace(p[0], " ").trim();
  }
  const m = s.match(/^([^@\s]+)@(\[[^\]]+\]|[^:\s]+)(?::(\d+))?$/);
  if (!m) return null;
  if (m[3]) port = Number(m[3]);
  return { username: m[1], hostname: m[2].replace(/^\[|\]$/g, ""), port };
}

export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}
