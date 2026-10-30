import clsx from "clsx";
import { Maximize2, Minimize2, SquareArrowOutUpRight, X } from "lucide-react";
import { useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { SessionIcon } from "../components/SessionIcon";
import { IconButton } from "../components/ui";
import { beginPaneDrag, usePaneDrag } from "../lib/paneDrag";
import { halfOf, layout, leaves, type Divider, type Rect } from "../lib/panes";
import { terminalTheme, useSettings } from "../lib/settings";
import { useApp, type Session, type TerminalTab } from "../store";
import { TerminalView } from "./TerminalView";

/** Half the gap between panes, in px. */
const GAP = 4;
const EDGE = 0.001;
const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 };

/** Absolute position for a rect in workspace fractions, padded on the sides that face another pane. */
function placed(r: Rect, pad: number): CSSProperties {
  const p = (inner: boolean) => (inner ? pad : 0);
  return {
    left: `${r.x * 100}%`,
    top: `${r.y * 100}%`,
    width: `${r.w * 100}%`,
    height: `${r.h * 100}%`,
    padding: `${p(r.y > EDGE)}px ${p(r.x + r.w < 1 - EDGE)}px ${p(r.y + r.h < 1 - EDGE)}px ${p(r.x > EDGE)}px`,
  };
}

/**
 * Every terminal session is rendered here, in one flat list, and positioned by the active tab's
 * layout. Moving a session between tabs or panes therefore never remounts it (or reconnects).
 */
export function TerminalLayer() {
  const sessions = useApp((s) => s.sessions);
  const tab = useApp((s) => s.tabs.find((t): t is TerminalTab => t.id === s.activeTab && t.kind === "terminal"));
  const innerRef = useRef<HTMLDivElement>(null);

  const multi = !!tab && leaves(tab.root).length > 1;
  const { panes, dividers } = useMemo(() => {
    if (!tab) return { panes: new Map<string, Rect>(), dividers: [] as Divider[] };
    if (tab.zoomed) return { panes: new Map([[tab.zoomed, FULL]]), dividers: [] as Divider[] };
    return layout(tab.root);
  }, [tab]);

  return (
    <div className={clsx("absolute inset-0", multi && "bg-app")} style={{ display: tab ? "block" : "none" }}>
      <div ref={innerRef} className={clsx("absolute", multi ? "inset-2" : "inset-0")}>
        {Object.values(sessions).map((s) => (
          <PaneFrame key={s.id} session={s} tab={tab} rect={panes.get(s.id)} multi={multi} />
        ))}
        {tab && dividers.map((d) => <DividerHandle key={d.path} d={d} tabId={tab.id} container={innerRef} />)}
        {tab && <DropZone tab={tab} panes={panes} multi={multi} />}
      </div>
    </div>
  );
}

/** "user@host: ~/src" → "~/src"; other titles are shown as they are. */
function shortTitle(t: string) {
  return /^[^@\s]+@[^:\s]+:\s*(.+)$/.exec(t)?.[1] ?? t;
}

function PaneFrame({ session, tab, rect, multi }: { session: Session; tab: TerminalTab | undefined; rect: Rect | undefined; multi: boolean }) {
  const termSettings = useSettings((s) => s.settings.terminal);
  const mode = useSettings((s) => s.mode);
  const focusPane = useApp((s) => s.focusPane);
  const dragging = usePaneDrag((s) => s.drag?.sessionId === session.id);
  const [title, setTitle] = useState("");
  const visible = !!tab && !!rect;
  const focused = visible && tab.focus === session.id;

  return (
    <div className="absolute" style={visible ? placed(rect, multi ? GAP : 0) : { display: "none" }}>
      <div
        data-pane={visible ? session.id : undefined}
        data-tab={tab?.id}
        onPointerDownCapture={() => tab && focusPane(tab.id, session.id)}
        className={clsx(
          "group/pane flex h-full w-full flex-col overflow-hidden",
          multi && "rounded-xl border transition-[border-color,opacity] duration-150",
          multi && (focused ? "border-fg/40" : "border-line"),
          dragging && "opacity-40",
        )}
        style={{ background: terminalTheme(termSettings, mode).background }}
      >
        {multi && tab && <PaneHeader session={session} tab={tab} title={title} focused={focused} />}
        <div className={clsx("relative min-h-0 flex-1", multi && "pb-1.5 pl-3 pr-1")}>
          <TerminalView sessionId={session.id} target={session.target} active={focused} onTitle={setTitle} />
        </div>
      </div>
    </div>
  );
}

function PaneHeader({ session, tab, title, focused }: { session: Session; tab: TerminalTab; title: string; focused: boolean }) {
  const detachPane = useApp((s) => s.detachPane);
  const toggleZoom = useApp((s) => s.toggleZoom);
  const closeSession = useApp((s) => s.closeSession);
  const zoomed = tab.zoomed === session.id;

  return (
    <div
      onPointerDown={(e) => {
        if (e.button === 0 && !(e.target as HTMLElement).closest("button")) beginPaneDrag(e, session.id);
      }}
      onDoubleClick={(e) => !(e.target as HTMLElement).closest("button") && toggleZoom(tab.id, session.id)}
      title="Drag to rearrange · double-click to maximize"
      className="flex h-9 shrink-0 cursor-grab items-center gap-2 pl-3 pr-1.5 text-[12.5px] active:cursor-grabbing"
    >
      <SessionIcon session={session} size={15} />
      <span className={clsx("truncate font-medium", focused ? "text-fg" : "text-muted")}>{session.title}</span>
      {title && <span className="min-w-0 truncate text-faint">{shortTitle(title)}</span>}
      <div className="flex-1" />
      <div className={clsx("flex shrink-0 items-center transition-opacity", focused ? "opacity-100" : "opacity-0 group-hover/pane:opacity-100")}>
        <IconButton className="h-7 w-7" title="Move to new tab" onClick={() => detachPane(session.id)}>
          <SquareArrowOutUpRight size={14} />
        </IconButton>
        <IconButton className="h-7 w-7" title={zoomed ? "Restore" : "Maximize"} onClick={() => toggleZoom(tab.id, session.id)}>
          {zoomed ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </IconButton>
        <IconButton className="h-7 w-7" title="Close" onClick={() => closeSession(session.id)}>
          <X size={15} />
        </IconButton>
      </div>
    </div>
  );
}

function DividerHandle({ d, tabId, container }: { d: Divider; tabId: string; container: RefObject<HTMLDivElement | null> }) {
  const resizePane = useApp((s) => s.resizePane);
  const row = d.dir === "row";
  const style: CSSProperties = row
    ? { left: `calc(${d.at * 100}% - ${GAP}px)`, top: `${d.area.y * 100}%`, width: GAP * 2, height: `${d.area.h * 100}%` }
    : { top: `calc(${d.at * 100}% - ${GAP}px)`, left: `${d.area.x * 100}%`, height: GAP * 2, width: `${d.area.w * 100}%` };

  const start = (e: React.PointerEvent) => {
    if (e.button !== 0 || !container.current) return;
    e.preventDefault();
    const box = container.current.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const f = row ? (ev.clientX - box.left) / box.width : (ev.clientY - box.top) / box.height;
      resizePane(tabId, d.path, row ? (f - d.area.x) / d.area.w : (f - d.area.y) / d.area.h);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = row ? "col-resize" : "row-resize";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div onPointerDown={start} className={clsx("group/div absolute z-10 flex items-center justify-center", row ? "cursor-col-resize" : "cursor-row-resize")} style={style}>
      <div className={clsx("rounded-full bg-accent opacity-0 transition-opacity group-hover/div:opacity-70", row ? "h-10 w-[3px]" : "h-[3px] w-10")} />
    </div>
  );
}

/** Frosted-glass preview of where a dragged session will land. */
function DropZone({ tab, panes, multi }: { tab: TerminalTab; panes: Map<string, Rect>; multi: boolean }) {
  const dragging = usePaneDrag((s) => !!s.drag);
  const over = usePaneDrag((s) => s.over);
  // The last zone stays rendered (faded out) while dragging, so the next one glides in from it.
  const last = useRef<{ zone: Rect; full: boolean } | null>(null);
  const target = over?.kind === "split" && over.tabId === tab.id ? over : null;
  const pane = target ? panes.get(target.target) : undefined;
  const current = target && pane ? { zone: target.full ? pane : halfOf(pane, target.side), full: target.full } : null;
  if (current) last.current = current;
  if (!dragging) last.current = null;
  const shown = current ?? last.current;
  if (!shown) return null;

  return (
    <div
      className={clsx("animate-in pointer-events-none absolute z-20 transition-[left,top,width,height,opacity] duration-150 ease-out", !current && "opacity-0")}
      style={{ ...placed(shown.zone, multi ? GAP : 0), ...(multi ? {} : { padding: 8 }) }}
    >
      <div className={clsx("glass flex h-full w-full items-center justify-center rounded-xl", shown.full && "!bg-danger/15")}>
        {shown.full && <span className="text-[13px] font-medium">A workspace holds up to 4 panes</span>}
      </div>
    </div>
  );
}

/** Chip that follows the pointer while a session is dragged. */
export function PaneDragGhost() {
  const drag = usePaneDrag((s) => s.drag);
  const x = usePaneDrag((s) => s.x);
  const y = usePaneDrag((s) => s.y);
  const over = usePaneDrag((s) => s.over);
  const session = useApp((s) => (drag ? s.sessions[drag.sessionId] : undefined));
  if (!drag || !session) return null;
  const hint = over?.kind === "detach" ? "New tab" : over?.kind === "split" && over.full ? "Workspace is full" : null;
  return (
    <div className="glass pointer-events-none fixed z-[100] flex h-9 items-center gap-2 rounded-xl px-3 text-[13px] font-medium" style={{ left: x + 14, top: y + 12 }}>
      <SessionIcon session={session} size={15} />
      <span className="max-w-[220px] truncate">{session.title}</span>
      {hint && <span className="text-xs font-normal text-muted">· {hint}</span>}
    </div>
  );
}
