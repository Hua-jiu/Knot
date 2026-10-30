/** Split layout of a terminal tab: a binary tree whose leaves are terminal sessions. */
export type PaneNode =
  | { type: "leaf"; session: string }
  | { type: "split"; dir: "row" | "col"; ratio: number; a: PaneNode; b: PaneNode };

/** Which edge of a pane a dragged session is dropped on. */
export type DropSide = "left" | "right" | "top" | "bottom";

export const MAX_PANES = 4;
const MIN_RATIO = 0.15;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function leaf(session: string): PaneNode {
  return { type: "leaf", session };
}

export function leaves(node: PaneNode): string[] {
  return node.type === "leaf" ? [node.session] : [...leaves(node.a), ...leaves(node.b)];
}

/** Remove a session; its sibling takes the parent's place. Null when the tree becomes empty. */
export function removeLeaf(node: PaneNode, session: string): PaneNode | null {
  if (node.type === "leaf") return node.session === session ? null : node;
  const a = removeLeaf(node.a, session);
  const b = removeLeaf(node.b, session);
  if (!a) return b;
  if (!b) return a;
  return a === node.a && b === node.b ? node : { ...node, a, b };
}

/** Split the pane showing `target`, putting `session` on `side` of it. */
export function insertLeaf(node: PaneNode, target: string, session: string, side: DropSide): PaneNode {
  if (node.type === "leaf") {
    if (node.session !== target) return node;
    const dir = side === "left" || side === "right" ? "row" : "col";
    const first = side === "left" || side === "top";
    return { type: "split", dir, ratio: 0.5, a: first ? leaf(session) : node, b: first ? node : leaf(session) };
  }
  return { ...node, a: insertLeaf(node.a, target, session, side), b: insertLeaf(node.b, target, session, side) };
}

/** Path of a split node: "" for the root, then "a"/"b" per level. */
export function setRatio(node: PaneNode, path: string, ratio: number): PaneNode {
  if (node.type === "leaf") return node;
  if (!path) return { ...node, ratio: Math.min(1 - MIN_RATIO, Math.max(MIN_RATIO, ratio)) };
  const [head, rest] = [path[0], path.slice(1)];
  return head === "a" ? { ...node, a: setRatio(node.a, rest, ratio) } : { ...node, b: setRatio(node.b, rest, ratio) };
}

export interface Divider {
  path: string;
  dir: "row" | "col";
  /** Area of the split being resized, as fractions of the workspace. */
  area: Rect;
  /** Position of the boundary (x for rows, y for columns), as a fraction of the workspace. */
  at: number;
}

/** Lay the tree out in the unit square. */
export function layout(node: PaneNode, rect: Rect = { x: 0, y: 0, w: 1, h: 1 }, path = ""): { panes: Map<string, Rect>; dividers: Divider[] } {
  if (node.type === "leaf") return { panes: new Map([[node.session, rect]]), dividers: [] };
  const { x, y, w, h } = rect;
  const [ra, rb]: [Rect, Rect] =
    node.dir === "row"
      ? [{ x, y, w: w * node.ratio, h }, { x: x + w * node.ratio, y, w: w * (1 - node.ratio), h }]
      : [{ x, y, w, h: h * node.ratio }, { x, y: y + h * node.ratio, w, h: h * (1 - node.ratio) }];
  const a = layout(node.a, ra, path + "a");
  const b = layout(node.b, rb, path + "b");
  const divider: Divider = { path, dir: node.dir, area: rect, at: node.dir === "row" ? ra.x + ra.w : ra.y + ra.h };
  return { panes: new Map([...a.panes, ...b.panes]), dividers: [divider, ...a.dividers, ...b.dividers] };
}

/** The half of `r` on `side`. */
export function halfOf(r: Rect, side: DropSide): Rect {
  switch (side) {
    case "left":
      return { ...r, w: r.w / 2 };
    case "right":
      return { ...r, x: r.x + r.w / 2, w: r.w / 2 };
    case "top":
      return { ...r, h: r.h / 2 };
    case "bottom":
      return { ...r, y: r.y + r.h / 2, h: r.h / 2 };
  }
}

/** The edge of a box closest to a point given as fractions (0–1) of its width and height. */
export function nearestSide(fx: number, fy: number): DropSide {
  const d: [DropSide, number][] = [
    ["left", fx],
    ["right", 1 - fx],
    ["top", fy],
    ["bottom", 1 - fy],
  ];
  return d.reduce((m, c) => (c[1] < m[1] ? c : m))[0];
}
