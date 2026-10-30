import { getCurrentWebview } from "@tauri-apps/api/webview";
import clsx from "clsx";
import { CheckCircle2, File, Folder, X, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, toApiError } from "../lib/api";
import { registerDropHandler, targetAt, useDrag, type DragPayload, type DropTarget, type Side } from "../lib/drag";
import { formatSize } from "../lib/format";
import { cancelTransfer, startTransfer, useFsVersion } from "../lib/transfers";
import { useApp } from "../store";
import { FilePane, type PaneHandle } from "./FilePane";

const EMPTY: PaneHandle = { source: null, label: "", cwd: null };

export function SftpView() {
  const [panes, setPanes] = useState<Record<Side, PaneHandle>>({ left: EMPTY, right: EMPTY });
  const panesRef = useRef(panes);
  panesRef.current = panes;
  const sftpRequest = useApp((s) => s.sftpRequest);
  const [split, setSplit] = useState(0.5);
  const containerRef = useRef<HTMLDivElement>(null);

  const onLeft = useCallback((h: PaneHandle) => setPanes((p) => ({ ...p, left: h })), []);
  const onRight = useCallback((h: PaneHandle) => setPanes((p) => ({ ...p, right: h })), []);

  // Drops between / within panes: same pane = move, other pane = copy.
  useEffect(
    () =>
      registerDropHandler(async (drag: DragPayload, target: DropTarget) => {
        const dest = panesRef.current[target.side];
        if (!dest.source) return;
        if (target.side === drag.side) {
          try {
            await api.fsMove(drag.source, drag.paths, target.dir);
          } catch (e) {
            useApp.getState().toast(toApiError(e).message, "error");
          }
          useFsVersion.getState().bump();
          return;
        }
        await startTransfer({
          from: drag.source,
          fromLabel: panesRef.current[drag.side].label,
          paths: drag.paths,
          to: dest.source,
          toLabel: dest.label,
          dir: target.dir,
        });
      }),
    [],
  );

  // Files dragged in from Finder / Explorer are uploaded (or copied) into the folder under the cursor.
  useEffect(() => {
    const un = getCurrentWebview().onDragDropEvent((ev) => {
      const p = ev.payload;
      if (p.type === "leave") return useDrag.setState({ over: null });
      const ratio = window.devicePixelRatio || 1;
      const t = targetAt(p.position.x / ratio, p.position.y / ratio);
      const dest = t ? panesRef.current[t.side] : null;
      if (p.type === "over" || p.type === "enter") {
        useDrag.setState({ over: dest?.source ? t : null });
        return;
      }
      useDrag.setState({ over: null });
      if (p.type === "drop" && t && dest?.source && p.paths.length) {
        void startTransfer({ from: { kind: "local" }, fromLabel: "Finder", paths: p.paths, to: dest.source, toLabel: dest.label, dir: t.dir });
      }
    });
    return () => void un.then((f) => f());
  }, []);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const rect = containerRef.current!.getBoundingClientRect();
    const move = (ev: PointerEvent) => setSplit(Math.min(0.75, Math.max(0.25, (ev.clientX - rect.left) / rect.width)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="flex h-full flex-col">
      <div ref={containerRef} className="flex min-h-0 flex-1">
        <div className="flex min-w-0" style={{ width: `${split * 100}%` }}>
          <FilePane side="left" initialLocal otherPane={panes.right} onState={onLeft} />
        </div>
        <div onPointerDown={startResize} onDoubleClick={() => setSplit(0.5)} className="group relative w-px shrink-0 cursor-col-resize bg-line">
          <div className="absolute inset-y-0 -left-1 -right-1 group-hover:bg-accent/40" />
        </div>
        <div className="flex min-w-0 flex-1">
          <FilePane side="right" initialLocal={false} otherPane={panes.left} onState={onRight} connectRequest={sftpRequest} />
        </div>
      </div>
      <TransfersBar />
      <DragGhost />
    </div>
  );
}

function DragGhost() {
  const drag = useDrag((s) => s.drag);
  const x = useDrag((s) => s.x);
  const y = useDrag((s) => s.y);
  const over = useDrag((s) => s.over);
  if (!drag) return null;
  const copy = over && over.side !== drag.side;
  return (
    <div className="pointer-events-none fixed z-50 flex items-center gap-2 rounded-lg border border-line bg-popover/95 px-3 py-1.5 text-[13px] shadow-2xl" style={{ left: x + 14, top: y + 10 }}>
      {drag.paths.length === 1 ? <File size={15} className="text-muted" /> : <Folder size={15} className="fill-folder text-folder" />}
      <span className="max-w-[240px] truncate">{drag.paths.length === 1 ? drag.names[0] : `${drag.paths.length} items`}</span>
      {over && <span className={clsx("rounded px-1.5 text-[11px] font-medium", copy ? "bg-emerald-500/20 text-emerald-500" : "bg-accent/20 text-accent")}>{copy ? "Copy" : "Move"}</span>}
    </div>
  );
}

function TransfersBar() {
  const transfers = useApp((s) => s.transfers);
  if (!transfers.length) return null;
  return (
    <div className="max-h-[180px] shrink-0 overflow-y-auto border-t border-line bg-chrome px-3 py-2">
      {transfers.map((t) => {
        const p = t.progress;
        const pct = p && p.bytesTotal ? Math.min(100, (p.bytesDone / p.bytesTotal) * 100) : t.status === "done" ? 100 : 0;
        return (
          <div key={t.id} className="flex h-9 items-center gap-3 text-[12.5px]">
            {t.status === "done" ? (
              <CheckCircle2 size={15} className="shrink-0 text-emerald-400" />
            ) : t.status === "failed" || t.status === "cancelled" ? (
              <XCircle size={15} className="shrink-0 text-danger" />
            ) : (
              <span className="w-[15px] shrink-0" />
            )}
            <div className="w-[260px] min-w-0 shrink-0">
              <div className="truncate">{t.label}</div>
              <div className="truncate text-[11px] text-faint">{t.direction}</div>
            </div>
            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-input">
              <div className={clsx("h-full rounded-full transition-[width]", t.status === "failed" ? "bg-danger" : "bg-accent")} style={{ width: `${pct}%` }} />
            </div>
            <div className="w-[170px] shrink-0 truncate text-right text-muted">
              {t.status === "running" && p
                ? `${formatSize(p.bytesDone)} / ${formatSize(p.bytesTotal)}${p.filesTotal > 1 ? ` · ${p.filesDone}/${p.filesTotal}` : ""}`
                : t.status === "running"
                  ? "Preparing…"
                  : t.status === "done"
                    ? "Done"
                    : t.status === "cancelled"
                      ? "Cancelled"
                      : "Failed"}
            </div>
            <button
              disabled={t.status !== "running"}
              onClick={() => cancelTransfer(t.id)}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-faint hover:bg-hover hover:text-fg disabled:invisible"
              title="Cancel"
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
