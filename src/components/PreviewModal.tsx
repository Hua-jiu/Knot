import { createPortal } from "react-dom";
import { File, Folder, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { formatDate, formatSize, imageMime, kindOf, looksLikeText } from "../lib/format";
import type { FileEntry, Source } from "../lib/types";
import { Spinner } from "./ui";

const TEXT_MAX = 1024 * 1024;
const IMAGE_MAX = 32 * 1024 * 1024;

type Content =
  | { kind: "loading" }
  | { kind: "image"; url: string }
  | { kind: "text"; text: string; truncated: boolean }
  | { kind: "info"; note?: string };

/**
 * Quick Look style preview. It never takes focus, so the file list keeps
 * handling Space / arrows / Esc while it's open (like Finder).
 */
export function PreviewModal({ source, entry, onClose }: { source: Source; entry: FileEntry; onClose: () => void }) {
  const [content, setContent] = useState<Content>({ kind: "loading" });

  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    setContent({ kind: "loading" });
    const load = async () => {
      if (entry.isDir) return setContent({ kind: "info" });
      const mime = imageMime(entry.name);
      if (mime && entry.size <= IMAGE_MAX) {
        const bytes = await api.fsPreview(source, entry.path, IMAGE_MAX);
        url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
        if (alive) setContent({ kind: "image", url });
        return;
      }
      const bytes = await api.fsPreview(source, entry.path, TEXT_MAX);
      if (!alive) return;
      if (looksLikeText(bytes)) {
        const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        setContent({ kind: "text", text, truncated: entry.size > bytes.length });
      } else {
        setContent({ kind: "info", note: "No preview available for this file type." });
      }
    };
    load().catch((e) => alive && setContent({ kind: "info", note: (e as { message: string }).message }));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [source, entry.path, entry.size, entry.isDir, entry.name]);

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-overlay" onMouseDown={(e) => e.preventDefault()} onClick={onClose}>
      <div
        className="animate-in flex max-h-[82vh] w-[min(900px,80vw)] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line/70 px-4">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{entry.name}</span>
          <span className="text-xs text-faint">{entry.isDir ? "folder" : formatSize(entry.size)}</span>
          <button onClick={onClose} className="ml-2 flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg">
            <X size={14} />
          </button>
        </div>
        <div className="min-h-[240px] flex-1 overflow-auto">
          {content.kind === "loading" && (
            <div className="flex h-[240px] items-center justify-center">
              <Spinner className="text-muted" />
            </div>
          )}
          {content.kind === "image" && (
            <div className="flex items-center justify-center bg-[repeating-conic-gradient(var(--color-checker-a)_0%_25%,var(--color-checker-b)_0%_50%)] bg-[length:20px_20px] p-4">
              <img src={content.url} alt={entry.name} className="max-h-[70vh] max-w-full object-contain" />
            </div>
          )}
          {content.kind === "text" && (
            <>
              <pre className="selectable m-0 whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed text-fg">{content.text}</pre>
              {content.truncated && <div className="border-t border-line/70 px-4 py-2 text-xs text-faint">Showing the first {formatSize(TEXT_MAX)}</div>}
            </>
          )}
          {content.kind === "info" && <InfoView entry={entry} note={content.note} />}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function InfoView({ entry, note }: { entry: FileEntry; note?: string }) {
  return (
    <div className="flex flex-col items-center gap-4 p-10">
      {entry.isDir ? <Folder size={64} className="fill-folder/80 text-folder" /> : <File size={64} className="text-muted" />}
      <div className="text-[15px] font-medium">{entry.name}</div>
      <div className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1.5 text-[13px]">
        <span className="text-muted">Kind</span>
        <span>{kindOf(entry)}</span>
        {!entry.isDir && (
          <>
            <span className="text-muted">Size</span>
            <span>{formatSize(entry.size)}</span>
          </>
        )}
        <span className="text-muted">Modified</span>
        <span>{formatDate(entry.modified)}</span>
        {entry.permissions && (
          <>
            <span className="text-muted">Permissions</span>
            <span className="font-mono text-xs">{entry.permissions}</span>
          </>
        )}
      </div>
      {note && <div className="text-xs text-faint">{note}</div>}
    </div>
  );
}
