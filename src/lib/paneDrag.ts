import type { PointerEvent as ReactPointerEvent } from "react";
import { create } from "zustand";
import { tabOfSession, useApp } from "../store";
import { leaves, MAX_PANES, nearestSide, type DropSide } from "./panes";

export type PaneDropTarget =
  | { kind: "split"; tabId: string; target: string; side: DropSide; full: boolean }
  /** Over the tab strip: the session becomes a tab of its own. */
  | { kind: "detach" };

interface PaneDragState {
  /** Session being dragged, from a tab or from a pane header. */
  drag: { sessionId: string } | null;
  x: number;
  y: number;
  over: PaneDropTarget | null;
}

export const usePaneDrag = create<PaneDragState>(() => ({ drag: null, x: 0, y: 0, over: null }));

const SPRING_MS = 450;

/** True right after a drag ended, so the tab that started it doesn't also handle the click. */
let justDragged = false;
export function consumeDragClick(): boolean {
  const v = justDragged;
  justDragged = false;
  return v;
}

function targetAt(sessionId: string, x: number, y: number): PaneDropTarget | null {
  const el = document.elementFromPoint(x, y);
  const pane = el?.closest<HTMLElement>("[data-pane]");
  if (pane) {
    const target = pane.dataset.pane!;
    const tabId = pane.dataset.tab!;
    if (target === sessionId) return null;
    const r = pane.getBoundingClientRect();
    const side = nearestSide((x - r.left) / r.width, (y - r.top) / r.height);
    const tab = useApp.getState().tabs.find((t) => t.id === tabId);
    const ids = tab?.kind === "terminal" ? leaves(tab.root) : [];
    return { kind: "split", tabId, target, side, full: !ids.includes(sessionId) && ids.length >= MAX_PANES };
  }
  if (el?.closest("[data-tab-strip]")) {
    const src = tabOfSession(sessionId);
    if (src && leaves(src.root).length > 1) return { kind: "detach" };
  }
  return null;
}

/** Track a pointer drag of a terminal session once it moves past a small threshold. */
export function beginPaneDrag(start: ReactPointerEvent, sessionId: string) {
  const sx = start.clientX;
  const sy = start.clientY;
  let started = false;
  let springTab: string | undefined;
  let springTimer: number | undefined;

  const move = (e: PointerEvent) => {
    if (!started) {
      if (Math.hypot(e.clientX - sx, e.clientY - sy) < 6) return;
      started = true;
      usePaneDrag.setState({ drag: { sessionId } });
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
      document.body.style.webkitUserSelect = "none";
    }
    const prev = usePaneDrag.getState().over;
    const next = targetAt(sessionId, e.clientX, e.clientY);
    // Keep the previous object when nothing changed, so the drop zone doesn't re-render on every move.
    const over = JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
    usePaneDrag.setState({ x: e.clientX, y: e.clientY, over });

    // Hovering another terminal tab switches to it, so the session can be dropped there.
    const tabEl = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-tab-id]");
    const id = tabEl?.dataset.tabKind === "terminal" ? tabEl.dataset.tabId : undefined;
    if (id !== springTab) {
      window.clearTimeout(springTimer);
      springTab = id;
      if (id && id !== useApp.getState().activeTab) springTimer = window.setTimeout(() => useApp.getState().setActive(id), SPRING_MS);
    }
  };

  const up = () => {
    const { over } = usePaneDrag.getState();
    const wasStarted = started;
    cleanup();
    if (!wasStarted) return;
    justDragged = true;
    setTimeout(() => (justDragged = false), 0);
    const app = useApp.getState();
    if (over?.kind === "split" && !over.full) app.movePane(sessionId, over.tabId, over.target, over.side);
    else if (over?.kind === "detach") app.detachPane(sessionId);
  };

  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cleanup();
    }
  };

  function cleanup() {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cleanup);
    window.removeEventListener("keydown", key, true);
    window.clearTimeout(springTimer);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    document.body.style.webkitUserSelect = "";
    usePaneDrag.setState({ drag: null, over: null });
  }

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cleanup);
  window.addEventListener("keydown", key, true);
}
