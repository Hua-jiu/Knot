import { create } from "zustand";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Source } from "./types";

export type Side = "left" | "right";

export interface DropTarget {
  side: Side;
  dir: string;
  /** Row whose folder is highlighted (absent when dropping onto the pane background). */
  rowPath?: string;
}

export interface DragPayload {
  side: Side;
  source: Source;
  paths: string[];
  names: string[];
  /** Directory the items currently live in (dropping back there is a no-op). */
  fromDir: string;
}

interface DragState {
  drag: DragPayload | null;
  x: number;
  y: number;
  over: DropTarget | null;
}

export const useDrag = create<DragState>(() => ({ drag: null, x: 0, y: 0, over: null }));

/** Panes register how to expand a folder (for spring-loading) and how to handle drops. */
const expanders = new Map<Side, (path: string) => void>();
let dropHandler: ((drag: DragPayload, target: DropTarget) => void) | null = null;

export function registerExpander(side: Side, fn: (path: string) => void) {
  expanders.set(side, fn);
  return () => void expanders.delete(side);
}
export function registerDropHandler(fn: typeof dropHandler) {
  dropHandler = fn;
  return () => void (dropHandler = null);
}

function pathWithin(path: string, ancestor: string) {
  if (path === ancestor) return true;
  const sep = ancestor.includes("\\") && !ancestor.includes("/") ? "\\" : "/";
  return path.startsWith(ancestor.endsWith(sep) ? ancestor : ancestor + sep);
}

export function isValidDrop(drag: DragPayload, t: DropTarget): boolean {
  if (t.side !== drag.side) return true;
  if (t.dir === drag.fromDir) return false;
  return !drag.paths.some((p) => pathWithin(t.dir, p));
}

/** Resolve the drop target under a viewport point from `data-drop-*` attributes. */
export function targetAt(x: number, y: number): DropTarget | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop-dir]");
  if (!el) return null;
  return { side: el.dataset.side as Side, dir: el.dataset.dropDir!, rowPath: el.dataset.dropRow };
}

const SPRING_MS = 650;
const EDGE = 36;

/** Start tracking a drag once the pointer moved past a small threshold. */
export function beginPointerDrag(start: PointerEvent | ReactPointerEvent, payload: () => DragPayload | null) {
  const sx = start.clientX;
  const sy = start.clientY;
  let started = false;
  let springTimer: number | undefined;
  let springPath: string | undefined;
  let raf = 0;
  let lastX = sx;
  let lastY = sy;

  const autoScroll = () => {
    const el = document.elementFromPoint(lastX, lastY)?.closest<HTMLElement>("[data-autoscroll]");
    if (el) {
      const r = el.getBoundingClientRect();
      if (lastY < r.top + EDGE) el.scrollTop -= Math.ceil((r.top + EDGE - lastY) / 3);
      else if (lastY > r.bottom - EDGE) el.scrollTop += Math.ceil((lastY - (r.bottom - EDGE)) / 3);
    }
    raf = requestAnimationFrame(autoScroll);
  };

  const move = (e: PointerEvent) => {
    lastX = e.clientX;
    lastY = e.clientY;
    if (!started) {
      if (Math.hypot(e.clientX - sx, e.clientY - sy) < 5) return;
      const p = payload();
      if (!p) return cleanup();
      started = true;
      useDrag.setState({ drag: p });
      document.body.style.cursor = "grabbing";
      raf = requestAnimationFrame(autoScroll);
    }
    const drag = useDrag.getState().drag!;
    let over = targetAt(e.clientX, e.clientY);
    if (over && !isValidDrop(drag, over)) over = null;
    useDrag.setState({ x: e.clientX, y: e.clientY, over });

    // Spring-loaded folders: hovering a collapsed folder expands it.
    const row = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-expandable='1']");
    const rp = row?.dataset.rowPath;
    if (rp !== springPath) {
      window.clearTimeout(springTimer);
      springPath = rp;
      if (rp && row) {
        const side = row.dataset.side as Side;
        springTimer = window.setTimeout(() => expanders.get(side)?.(rp), SPRING_MS);
      }
    }
  };

  const up = () => {
    const { drag, over } = useDrag.getState();
    cleanup();
    if (started && drag && over && dropHandler) dropHandler(drag, over);
  };

  const key = (e: KeyboardEvent) => e.key === "Escape" && cleanup();

  function cleanup() {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("keydown", key);
    window.clearTimeout(springTimer);
    cancelAnimationFrame(raf);
    document.body.style.cursor = "";
    useDrag.setState({ drag: null, over: null });
  }

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("keydown", key);
}
