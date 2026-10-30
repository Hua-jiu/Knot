import { create } from "zustand";
import { api } from "./lib/api";
import { insertLeaf, leaf, leaves, MAX_PANES, removeLeaf, setRatio, type DropSide, type PaneNode } from "./lib/panes";
import type { Host, KeyEntry, Progress, Target } from "./lib/types";

/** One terminal connection. Sessions outlive the tab they were opened in when moved between tabs. */
export interface Session {
  id: string;
  title: string;
  target: Target;
  hostId?: string;
}

/** A terminal tab shows one session, or several side by side (a "workspace"). */
export interface TerminalTab {
  id: string;
  kind: "terminal";
  root: PaneNode;
  /** Session that receives keyboard input. */
  focus: string;
  /** Workspace name set by the user. */
  name?: string;
  /** Session temporarily filling the whole tab. */
  zoomed?: string;
}

export type Tab = { id: "vault"; kind: "vault" } | { id: "sftp"; kind: "sftp" } | TerminalTab;

export interface Toast {
  id: number;
  kind: "info" | "error" | "success";
  message: string;
}

export interface Transfer {
  id: string;
  label: string;
  direction: string;
  progress: Progress | null;
  status: "running" | "done" | "failed" | "cancelled";
  error?: string;
}

type VaultSection = "hosts" | "keychain" | "settings";

interface AppStore {
  tabs: Tab[];
  activeTab: string;
  sessions: Record<string, Session>;
  section: VaultSection;
  hosts: Host[];
  keys: KeyEntry[];
  toasts: Toast[];
  transfers: Transfer[];
  /** Set by "Open in SFTP" in the vault; consumed by the right SFTP pane. */
  sftpRequest: { hostId: string; nonce: number } | null;
  /** The title bar's host picker, also opened by a keyboard shortcut. */
  pickerOpen: boolean;

  setActive(id: string): void;
  setSection(s: VaultSection): void;
  setPickerOpen(open: boolean): void;
  openTerminal(target: Target, title: string, hostId?: string): void;
  /** Close a tab and every session in it. */
  closeTab(id: string): void;
  /** Close one session; its tab closes with its last session. */
  closeSession(sessionId: string): void;
  focusPane(tabId: string, sessionId: string): void;
  /** Move a session next to `target` (in any terminal tab). */
  movePane(sessionId: string, tabId: string, target: string, side: DropSide): void;
  /** Move a session out of its workspace into a tab of its own. */
  detachPane(sessionId: string): void;
  /** Split a workspace back into one tab per session. */
  ungroup(tabId: string): void;
  resizePane(tabId: string, path: string, ratio: number): void;
  toggleZoom(tabId: string, sessionId: string): void;
  renameTab(tabId: string, name: string): void;
  openInSftp(hostId: string): void;
  refreshHosts(): Promise<void>;
  refreshKeys(): Promise<void>;
  toast(message: string, kind?: Toast["kind"]): void;
  dismissToast(id: number): void;
  upsertTransfer(t: Transfer): void;
  removeTransfer(id: string): void;
}

let toastSeq = 0;
let tabSeq = 0;

export const useApp = create<AppStore>((set, get) => ({
  tabs: [
    { id: "vault", kind: "vault" },
    { id: "sftp", kind: "sftp" },
  ],
  activeTab: "vault",
  sessions: {},
  section: "hosts",
  hosts: [],
  keys: [],
  toasts: [],
  transfers: [],
  sftpRequest: null,
  pickerOpen: false,

  setActive: (id) => set({ activeTab: id }),
  setSection: (section) => set({ section }),
  setPickerOpen: (pickerOpen) => set({ pickerOpen }),

  openTerminal: (target, title, hostId) => {
    const id = `term-${++tabSeq}`;
    const sid = `s-${tabSeq}`;
    const tab: TerminalTab = { id, kind: "terminal", root: leaf(sid), focus: sid };
    set((s) => ({ sessions: { ...s.sessions, [sid]: { id: sid, title, target, hostId } }, tabs: [...s.tabs, tab], activeTab: id }));
  },

  closeTab: (id) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (tab?.kind !== "terminal") return;
    const gone = new Set(leaves(tab.root));
    set((s) => ({
      ...withoutTab(s, id),
      sessions: Object.fromEntries(Object.entries(s.sessions).filter(([sid]) => !gone.has(sid))),
    }));
  },

  closeSession: (sessionId) => {
    set((s) => {
      const { [sessionId]: _, ...sessions } = s.sessions;
      return { ...detach(s, sessionId), sessions };
    });
  },

  focusPane: (tabId, sessionId) => set((s) => ({ tabs: mapTerminal(s.tabs, tabId, (t) => (t.focus === sessionId ? t : { ...t, focus: sessionId })) })),

  movePane: (sessionId, tabId, target, side) => {
    const s = get();
    const dest = s.tabs.find((t): t is TerminalTab => t.id === tabId && t.kind === "terminal");
    if (!dest || sessionId === target || !leaves(dest.root).includes(target)) return;
    const same = leaves(dest.root).includes(sessionId);
    if (!same && leaves(dest.root).length >= MAX_PANES) return;
    // Take the session out of wherever it is (closing an emptied tab), then split the target.
    const next = detach(s, sessionId);
    set({
      tabs: mapTerminal(next.tabs, tabId, (t) => ({ ...t, root: insertLeaf(t.root, target, sessionId, side), focus: sessionId, zoomed: undefined })),
      activeTab: tabId,
    });
  },

  detachPane: (sessionId) => {
    const s = get();
    const from = s.tabs.findIndex((t) => t.kind === "terminal" && leaves(t.root).includes(sessionId));
    const src = s.tabs[from] as TerminalTab | undefined;
    if (!src || leaves(src.root).length < 2) return;
    const id = `term-${++tabSeq}`;
    const tabs = detach(s, sessionId).tabs;
    const at = tabs.findIndex((t) => t.id === src.id) + 1;
    tabs.splice(at, 0, { id, kind: "terminal", root: leaf(sessionId), focus: sessionId });
    set({ tabs, activeTab: id });
  },

  ungroup: (tabId) => {
    const s = get();
    const i = s.tabs.findIndex((t) => t.id === tabId);
    const tab = s.tabs[i];
    if (tab?.kind !== "terminal") return;
    const split: TerminalTab[] = leaves(tab.root).map((sid) => ({ id: `term-${++tabSeq}`, kind: "terminal", root: leaf(sid), focus: sid }));
    const tabs = [...s.tabs.slice(0, i), ...split, ...s.tabs.slice(i + 1)];
    set({ tabs, activeTab: split.find((t) => t.focus === tab.focus)?.id ?? split[0].id });
  },

  resizePane: (tabId, path, ratio) => set((s) => ({ tabs: mapTerminal(s.tabs, tabId, (t) => ({ ...t, root: setRatio(t.root, path, ratio) })) })),

  toggleZoom: (tabId, sessionId) =>
    set((s) => ({ tabs: mapTerminal(s.tabs, tabId, (t) => ({ ...t, focus: sessionId, zoomed: t.zoomed === sessionId ? undefined : sessionId })) })),

  renameTab: (tabId, name) => set((s) => ({ tabs: mapTerminal(s.tabs, tabId, (t) => ({ ...t, name: name.trim() || undefined })) })),

  openInSftp: (hostId) => set({ activeTab: "sftp", sftpRequest: { hostId, nonce: Date.now() } }),

  refreshHosts: async () => set({ hosts: await api.hostsList() }),
  refreshKeys: async () => set({ keys: await api.keysList() }),

  toast: (message, kind = "info") => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    setTimeout(() => get().dismissToast(id), kind === "error" ? 7000 : 3500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  upsertTransfer: (t) =>
    set((s) => {
      const i = s.transfers.findIndex((x) => x.id === t.id);
      if (i < 0) return { transfers: [...s.transfers, t] };
      const transfers = s.transfers.slice();
      transfers[i] = t;
      return { transfers };
    }),
  removeTransfer: (id) => set((s) => ({ transfers: s.transfers.filter((t) => t.id !== id) })),
}));

function mapTerminal(tabs: Tab[], id: string, fn: (t: TerminalTab) => TerminalTab): Tab[] {
  return tabs.map((t) => (t.id === id && t.kind === "terminal" ? fn(t) : t));
}

/** Remove a tab, activating its neighbour if it was active. */
function withoutTab(s: Pick<AppStore, "tabs" | "activeTab">, id: string): Pick<AppStore, "tabs" | "activeTab"> {
  const idx = s.tabs.findIndex((t) => t.id === id);
  const tabs = s.tabs.filter((t) => t.id !== id);
  const activeTab = s.activeTab === id ? (tabs[Math.min(idx, tabs.length - 1)]?.id ?? "vault") : s.activeTab;
  return { tabs, activeTab };
}

/** Take a session out of its tab's layout; a tab left empty is removed. */
function detach(s: Pick<AppStore, "tabs" | "activeTab">, sessionId: string): Pick<AppStore, "tabs" | "activeTab"> {
  const tab = s.tabs.find((t): t is TerminalTab => t.kind === "terminal" && leaves(t.root).includes(sessionId));
  if (!tab) return { tabs: s.tabs, activeTab: s.activeTab };
  const root = removeLeaf(tab.root, sessionId);
  if (!root) return withoutTab(s, tab.id);
  const rest = leaves(root);
  const updated: TerminalTab = {
    ...tab,
    root,
    focus: tab.focus === sessionId ? rest[0] : tab.focus,
    zoomed: tab.zoomed === sessionId ? undefined : tab.zoomed,
    // A workspace that is back to one pane is a plain tab again.
    name: rest.length > 1 ? tab.name : undefined,
  };
  return { tabs: s.tabs.map((t) => (t.id === tab.id ? updated : t)), activeTab: s.activeTab };
}

/** The tab a session is shown in. */
export function tabOfSession(sessionId: string): TerminalTab | undefined {
  return useApp.getState().tabs.find((t): t is TerminalTab => t.kind === "terminal" && leaves(t.root).includes(sessionId));
}

/** Session with keyboard focus in the active tab, if it's a terminal tab. */
export function focusedSession(): string | undefined {
  const { tabs, activeTab } = useApp.getState();
  const t = tabs.find((x) => x.id === activeTab);
  return t?.kind === "terminal" ? t.focus : undefined;
}

export function hostById(id: string | null | undefined): Host | undefined {
  return id ? useApp.getState().hosts.find((h) => h.id === id) : undefined;
}
