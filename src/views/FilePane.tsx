import clsx from "clsx";
import {
  ArrowDownUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  File,
  FileSymlink,
  Folder,
  FolderOpen,
  FolderPlus,
  Home,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  Unplug,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { confirmDialog, promptDialog } from "../components/Dialogs";
import { HostPicker, type PickResult } from "../components/HostPicker";
import { OsIcon } from "../components/OsIcon";
import { PreviewModal } from "../components/PreviewModal";
import { Button, Context, IconButton, Menu, Spinner } from "../components/ui";
import { api, toApiError } from "../lib/api";
import { withPasswordRetry } from "../lib/connect";
import { beginPointerDrag, registerExpander, useDrag, type Side } from "../lib/drag";
import { formatDate, formatSize, isMac, kindOf, naturalCompare } from "../lib/format";
import { startTransfer, useFsVersion } from "../lib/transfers";
import type { FileEntry, Listing, Source, Target } from "../lib/types";
import { useSettings } from "../lib/settings";
import { useApp } from "../store";

type Conn =
  | { kind: "none" }
  | { kind: "local" }
  | { kind: "connecting"; label: string; os?: string | null }
  | { kind: "remote"; sessionId: string; label: string; os?: string | null }
  | { kind: "error"; label: string; message: string; pick: PickResult };

type SortKey = "name" | "modified" | "size" | "kind";

interface Row {
  entry: FileEntry;
  depth: number;
  /** Directory containing this entry. */
  dir: string;
}

export interface PaneHandle {
  source: Source | null;
  label: string;
  cwd: string | null;
}

export function FilePane({
  side,
  initialLocal,
  otherPane,
  onState,
  connectRequest,
}: {
  side: Side;
  initialLocal: boolean;
  otherPane: PaneHandle;
  onState: (h: PaneHandle) => void;
  connectRequest?: { hostId: string; nonce: number } | null;
}) {
  const toast = useApp((s) => s.toast);
  const hosts = useApp((s) => s.hosts);
  const fsVersion = useFsVersion((s) => s.version);

  const [conn, setConn] = useState<Conn>(initialLocal ? { kind: "local" } : { kind: "none" });
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [children, setChildren] = useState<Map<string, FileEntry[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "name", asc: true });
  const [filter, setFilter] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const sftpSettings = useSettings((s) => s.settings.sftp);
  const [showHidden, setShowHidden] = useState(() => useSettings.getState().settings.sftp.showHidden);
  const [history, setHistory] = useState<{ back: string[]; fwd: string[] }>({ back: [], fwd: [] });
  const [preview, setPreview] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const listingRef = useRef(listing);
  listingRef.current = listing;
  const typeahead = useRef({ text: "", at: 0 });

  const source: Source | null = useMemo(
    () => (conn.kind === "local" ? { kind: "local" } : conn.kind === "remote" ? { kind: "remote", sessionId: conn.sessionId } : null),
    [conn],
  );
  const label = conn.kind === "local" ? "Local" : conn.kind === "remote" || conn.kind === "connecting" ? conn.label : "";
  const cwd = listing?.path ?? null;

  useEffect(() => onState({ source, label, cwd }), [source, label, cwd, onState]);

  // ----- loading -----

  const loadDir = useCallback(
    async (src: Source, path: string) => api.fsList(src, path, showHidden),
    [showHidden],
  );

  const navigate = useCallback(
    async (path: string, mode: "push" | "back" | "fwd" | "replace" = "push", src: Source | null = source) => {
      if (!src) return;
      setLoading(true);
      try {
        const l = await loadDir(src, path);
        setListError(null);
        const prev = listingRef.current;
        if (prev && mode !== "replace" && prev.path !== l.path) {
          setHistory((h) =>
            mode === "back"
              ? { back: h.back.slice(0, -1), fwd: [...h.fwd, prev.path] }
              : mode === "fwd"
                ? { back: [...h.back, prev.path], fwd: h.fwd.slice(0, -1) }
                : { back: [...h.back, prev.path], fwd: [] },
          );
        }
        setListing(l);
        setExpanded(new Set());
        setChildren(new Map());
        setSelection([]);
        setAnchor(null);
        setPreview(false);
        listRef.current?.scrollTo(0, 0);
      } catch (e) {
        const err = toApiError(e);
        if (mode === "replace") setListError(err.message);
        else toast(err.message, "error");
      } finally {
        setLoading(false);
      }
    },
    [source, loadDir, toast],
  );

  /** Reload the current folder and every expanded subfolder, keeping view state. */
  const refresh = useCallback(async () => {
    if (!source || !listing) return;
    try {
      const l = await loadDir(source, listing.path);
      const dirs = [...expanded];
      const results = await Promise.allSettled(dirs.map((d) => loadDir(source, d)));
      const nextChildren = new Map<string, FileEntry[]>();
      const nextExpanded = new Set<string>();
      results.forEach((r, i) => {
        if (r.status === "fulfilled") {
          nextChildren.set(dirs[i], r.value.entries);
          nextExpanded.add(dirs[i]);
        }
      });
      setListing(l);
      setChildren(nextChildren);
      setExpanded(nextExpanded);
      const alive = new Set([...l.entries, ...[...nextChildren.values()].flat()].map((e) => e.path));
      setSelection((sel) => sel.filter((p) => alive.has(p)));
    } catch (e) {
      toast(toApiError(e).message, "error");
    }
  }, [source, listing, expanded, loadDir, toast]);

  // Initial / source change → go home.
  useEffect(() => {
    if (!source) {
      setListing(null);
      return;
    }
    setHistory({ back: [], fwd: [] });
    api
      .fsHome(source)
      .then((home) => navigate(home, "replace", source))
      .catch((e) => setListError(toApiError(e).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  // Hidden-files toggle and finished transfers reload in place.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHidden, fsVersion]);

  const expand = useCallback(
    async (path: string) => {
      if (!source || expanded.has(path)) return;
      setLoadingDirs((s) => new Set(s).add(path));
      try {
        const l = await loadDir(source, path);
        setChildren((m) => new Map(m).set(path, l.entries));
        setExpanded((s) => new Set(s).add(path));
      } catch (e) {
        toast(toApiError(e).message, "error");
      } finally {
        setLoadingDirs((s) => {
          const n = new Set(s);
          n.delete(path);
          return n;
        });
      }
    },
    [source, expanded, loadDir, toast],
  );

  const collapse = useCallback((path: string) => {
    setExpanded((s) => {
      const n = new Set(s);
      for (const p of s) if (p === path || p.startsWith(path.endsWith("/") ? path : path + "/") || p.startsWith(path + "\\")) n.delete(p);
      return n;
    });
  }, []);

  useEffect(() => registerExpander(side, (p) => void expand(p)), [side, expand]);

  // ----- connecting -----

  const closeRemote = useCallback(() => {
    if (conn.kind === "remote") void api.sftpClose(conn.sessionId);
  }, [conn]);

  // Close the SFTP session on unmount.
  const connRef = useRef(conn);
  connRef.current = conn;
  useEffect(() => () => void (connRef.current.kind === "remote" && api.sftpClose(connRef.current.sessionId)), []);

  const pick = useCallback(
    async (r: PickResult) => {
      closeRemote();
      setListing(null);
      if (r.kind === "local") return setConn({ kind: "local" });
      const label = r.kind === "host" ? r.host.label : `${r.username}@${r.hostname}`;
      const os = r.kind === "host" ? r.host.os : null;
      const target: Target =
        r.kind === "host" ? { kind: "saved", hostId: r.host.id } : { kind: "adhoc", hostname: r.hostname, port: r.port, username: r.username };
      setConn({ kind: "connecting", label, os });
      try {
        const { sessionId } = await withPasswordRetry(target, (t) => api.sftpOpen(t));
        setConn({ kind: "remote", sessionId, label, os });
      } catch (e) {
        const err = toApiError(e);
        if (err.code === "cancelled") setConn({ kind: "none" });
        else setConn({ kind: "error", label, message: err.message, pick: r });
      }
    },
    [closeRemote],
  );

  useEffect(() => {
    if (!connectRequest) return;
    const h = hosts.find((x) => x.id === connectRequest.hostId);
    if (h) void pick({ kind: "host", host: h });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectRequest?.nonce]);

  // ----- rows -----

  const rows = useMemo(() => {
    if (!listing) return [] as Row[];
    const q = filter.trim().toLowerCase();
    const dir = sort.asc ? 1 : -1;
    const cmp = (a: FileEntry, b: FileEntry) => {
      if (sftpSettings.foldersFirst && a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      let r = 0;
      if (sort.key === "modified") r = (a.modified ?? 0) - (b.modified ?? 0);
      else if (sort.key === "size") r = a.size - b.size;
      else if (sort.key === "kind") r = naturalCompare(kindOf(a), kindOf(b));
      return (r || naturalCompare(a.name, b.name)) * dir;
    };
    const out: Row[] = [];
    const walk = (entries: FileEntry[], depth: number, parent: string) => {
      for (const e of [...entries].sort(cmp)) {
        const open = e.isDir && expanded.has(e.path);
        if (q && !open && !e.name.toLowerCase().includes(q)) continue;
        out.push({ entry: e, depth, dir: parent });
        if (open) walk(children.get(e.path) ?? [], depth + 1, e.path);
      }
    };
    walk(listing.entries, 0, listing.path);
    return out;
  }, [listing, children, expanded, sort, filter, sftpSettings.foldersFirst]);

  const selected = useMemo(() => new Set(selection), [selection]);
  const lead = selection[selection.length - 1] ?? null;
  const leadRow = rows.find((r) => r.entry.path === lead) ?? null;

  const selectOnly = (path: string) => {
    setSelection([path]);
    setAnchor(path);
  };

  const clickRow = (e: React.MouseEvent, row: Row) => {
    const p = row.entry.path;
    if (e.metaKey || e.ctrlKey) {
      setSelection((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]));
      setAnchor(p);
    } else if (e.shiftKey && anchor) {
      const a = rows.findIndex((r) => r.entry.path === anchor);
      const b = rows.findIndex((r) => r.entry.path === p);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const range = rows.slice(lo, hi + 1).map((r) => r.entry.path);
        // Keep the clicked row last so it becomes the lead.
        setSelection([...range.filter((x) => x !== p), p]);
      }
    } else {
      selectOnly(p);
    }
  };

  const open = (row: Row) => {
    if (row.entry.isDir) void navigate(row.entry.path);
    else {
      selectOnly(row.entry.path);
      setPreview(true);
    }
  };

  const scrollIntoView = (path: string) => {
    requestAnimationFrame(() => {
      const el = listRef.current?.querySelector<HTMLElement>(`[data-row-path="${CSS.escape(path)}"]`);
      el?.scrollIntoView({ block: "nearest" });
    });
  };

  // ----- actions -----

  const selectedEntries = () => rows.filter((r) => selected.has(r.entry.path)).map((r) => r.entry);

  const newFolder = async () => {
    if (!source || !listing) return;
    // New folder goes inside the selected folder if exactly one is selected (and expanded), else cwd.
    const target = leadRow?.entry.isDir && expanded.has(leadRow.entry.path) ? leadRow.entry.path : listing.path;
    const name = await promptDialog({ title: "New Folder", label: "Name", initial: "untitled folder", confirmLabel: "Create" });
    if (!name) return;
    try {
      const path = await api.fsMkdir(source, target, name);
      await refresh();
      selectOnly(path);
      scrollIntoView(path);
    } catch (e) {
      toast(toApiError(e).message, "error");
    }
  };

  const remove = async () => {
    const items = selectedEntries();
    if (!source || !items.length) return;
    const what = items.length === 1 ? `“${items[0].name}”` : `${items.length} items`;
    const where = conn.kind === "remote" ? ` on ${label}` : "";
    const ok =
      !sftpSettings.confirmDelete ||
      (await confirmDialog({
        title: `Delete ${what}?`,
        message: `This permanently deletes ${what}${where}. It does not go to the Trash.`,
        confirmLabel: "Delete",
        danger: true,
      }));
    if (!ok) return;
    try {
      await api.fsDelete(source, items.map((i) => i.path));
    } catch (e) {
      toast(toApiError(e).message, "error");
    }
    await refresh();
  };

  const commitRename = async (path: string, name: string) => {
    setRenaming(null);
    const entry = rows.find((r) => r.entry.path === path)?.entry;
    if (!source || !entry || !name.trim() || name === entry.name) return;
    try {
      const dest = await api.fsRename(source, path, name.trim());
      await refresh();
      selectOnly(dest);
    } catch (e) {
      toast(toApiError(e).message, "error");
    }
  };

  const sendToOther = () => {
    const items = selectedEntries();
    if (!source || !otherPane.source || !otherPane.cwd || !items.length) return;
    void startTransfer({
      from: source,
      fromLabel: label,
      paths: items.map((i) => i.path),
      to: otherPane.source,
      toLabel: otherPane.label,
      dir: otherPane.cwd,
    });
  };

  // ----- keyboard -----

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (renaming) return;
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const idx = lead ? rows.findIndex((r) => r.entry.path === lead) : -1;
    const moveTo = (i: number) => {
      const r = rows[Math.max(0, Math.min(rows.length - 1, i))];
      if (!r) return;
      if (e.shiftKey) setSelection((s) => [...s.filter((x) => x !== r.entry.path), r.entry.path]);
      else selectOnly(r.entry.path);
      scrollIntoView(r.entry.path);
    };

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (mod && leadRow) open(leadRow);
        else moveTo(idx < 0 ? 0 : idx + 1);
        return;
      case "ArrowUp":
        e.preventDefault();
        if (mod) listing?.parent && void navigate(listing.parent);
        else moveTo(idx < 0 ? rows.length - 1 : idx - 1);
        return;
      case "ArrowRight":
        e.preventDefault();
        if (leadRow?.entry.isDir) {
          if (!expanded.has(leadRow.entry.path)) void expand(leadRow.entry.path);
          else if (rows[idx + 1]?.depth > leadRow.depth) moveTo(idx + 1);
        }
        return;
      case "ArrowLeft":
        e.preventDefault();
        if (leadRow?.entry.isDir && expanded.has(leadRow.entry.path)) collapse(leadRow.entry.path);
        else if (leadRow && leadRow.depth > 0) {
          selectOnly(leadRow.dir);
          scrollIntoView(leadRow.dir);
        }
        return;
      case " ":
        e.preventDefault();
        if (lead) setPreview((p) => !p);
        return;
      case "Enter":
        e.preventDefault();
        if (lead) setRenaming(lead);
        return;
      case "Escape":
        if (preview) setPreview(false);
        else if (filter) setFilter("");
        else setSelection([]);
        return;
      case "Backspace":
      case "Delete":
        if (e.key === "Delete" || mod) {
          e.preventDefault();
          void remove();
        }
        return;
    }
    if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setSelection(rows.map((r) => r.entry.path));
      return;
    }
    if (mod && e.key === "[" && history.back.length) return void navigate(history.back[history.back.length - 1], "back");
    if (mod && e.key === "]" && history.fwd.length) return void navigate(history.fwd[history.fwd.length - 1], "fwd");
    if (mod && e.key.toLowerCase() === "r") {
      e.preventDefault();
      return void refresh();
    }
    if (mod && e.shiftKey && e.key.toLowerCase() === "n") {
      e.preventDefault();
      return void newFolder();
    }
    // Type-to-select.
    if (!mod && !e.altKey && e.key.length === 1) {
      const t = typeahead.current;
      const now = Date.now();
      t.text = now - t.at > 800 ? e.key.toLowerCase() : t.text + e.key.toLowerCase();
      t.at = now;
      const hit = rows.find((r) => r.entry.name.toLowerCase().startsWith(t.text));
      if (hit) {
        selectOnly(hit.entry.path);
        scrollIntoView(hit.entry.path);
      }
    }
  };

  // ----- drag -----

  const dragOver = useDrag((s) => s.over);
  const dragging = useDrag((s) => s.drag);
  const dropRow = dragOver?.side === side ? dragOver.rowPath : undefined;
  const dropPane = dragOver?.side === side && !dragOver.rowPath && dragOver.dir === cwd;

  const startDrag = (e: React.PointerEvent, row: Row) => {
    if (e.button !== 0 || !source || renaming) return;
    const p = row.entry.path;
    const paths = selected.has(p) ? selection : [p];
    beginPointerDrag(e, () => {
      if (!selected.has(p)) selectOnly(p);
      const items = rows.filter((r) => paths.includes(r.entry.path));
      const dirs = new Set(items.map((r) => r.dir));
      return {
        side,
        source,
        paths: items.map((r) => r.entry.path),
        names: items.map((r) => r.entry.name),
        fromDir: dirs.size === 1 ? [...dirs][0] : "",
      };
    });
  };

  // ----- render -----

  const previewEntry = preview && leadRow ? leadRow.entry : null;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-app">
      {/* Header: source + filter + actions */}
      <div className="flex h-[60px] shrink-0 items-center gap-2 bg-chrome px-3">
        <HostPicker includeLocal open={pickerOpen} onOpenChange={setPickerOpen} onPick={(r) => void pick(r)}>
          <button className="flex min-w-0 items-center gap-2.5 rounded-lg py-1.5 pl-1.5 pr-2 hover:bg-hover">
            {conn.kind === "local" ? (
              <OsIcon os="local" size={32} />
            ) : conn.kind === "none" ? (
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-raised text-muted">
                <Unplug size={16} />
              </div>
            ) : (
              <OsIcon os={conn.kind === "error" ? null : conn.os} size={32} />
            )}
            <span className="truncate text-[14px] font-medium">{conn.kind === "none" ? "Select host" : label}</span>
            <ChevronDown size={14} className="shrink-0 text-faint" />
          </button>
        </HostPicker>
        <div className="flex-1" />
        {source &&
          (filterOpen ? (
            <div className="flex h-8 items-center gap-1.5 rounded-lg bg-input pl-2.5 pr-1">
              <Search size={14} className="text-faint" />
              <input
                autoFocus
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setFilter("");
                    setFilterOpen(false);
                    listRef.current?.focus();
                  }
                  if (e.key === "ArrowDown" || e.key === "Enter") listRef.current?.focus();
                }}
                placeholder="Filter"
                spellCheck={false}
                className="w-36 bg-transparent text-[13px] outline-none placeholder:text-faint"
              />
              <IconButton
                className="h-6 w-6"
                onClick={() => {
                  setFilter("");
                  setFilterOpen(false);
                }}
              >
                <X size={13} />
              </IconButton>
            </div>
          ) : (
            <Button variant="ghost" onClick={() => setFilterOpen(true)}>
              <Search size={16} /> Filter
            </Button>
          ))}
        {source && (
          <Menu.Root>
            <Menu.Trigger asChild>
              <Button variant="ghost">
                Actions <ChevronDown size={14} />
              </Button>
            </Menu.Trigger>
            <Menu.Content align="end">
              <Menu.Item onSelect={newFolder}>
                <FolderPlus size={15} /> New Folder
              </Menu.Item>
              <Menu.Item onSelect={() => void refresh()}>
                <RefreshCw size={15} /> Refresh
              </Menu.Item>
              <Menu.Item onSelect={() => setShowHidden((v) => !v)}>
                {showHidden ? <EyeOff size={15} /> : <Eye size={15} />} {showHidden ? "Hide" : "Show"} hidden files
              </Menu.Item>
              <Menu.Item onSelect={() => source && api.fsHome(source).then((h) => navigate(h))}>
                <Home size={15} /> Go to home
              </Menu.Item>
              {conn.kind === "remote" && (
                <>
                  <Menu.Separator />
                  <Menu.Item
                    danger
                    onSelect={() => {
                      closeRemote();
                      setConn({ kind: "none" });
                    }}
                  >
                    <Unplug size={15} /> Disconnect
                  </Menu.Item>
                </>
              )}
            </Menu.Content>
          </Menu.Root>
        )}
      </div>

      {conn.kind === "none" && <EmptyState onSelect={() => setPickerOpen(true)} />}
      {conn.kind === "connecting" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted">
          <Spinner className="text-accent" /> Connecting to {conn.label}…
        </div>
      )}
      {conn.kind === "error" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <div className="text-[15px] font-semibold">Couldn't connect to {conn.label}</div>
          <div className="max-w-[420px] text-[13px] text-muted">{conn.message}</div>
          <div className="mt-2 flex gap-2">
            <Button onClick={() => setPickerOpen(true)}>Choose another</Button>
            <Button variant="primary" onClick={() => void pick(conn.pick)}>
              Retry
            </Button>
          </div>
        </div>
      )}

      {source && (
        <>
          {/* Navigation + breadcrumbs */}
          <div className="flex h-12 shrink-0 items-center gap-1 bg-chrome px-2">
            <IconButton
              disabled={!history.back.length}
              onClick={() => navigate(history.back[history.back.length - 1], "back")}
              title="Back"
            >
              <ChevronLeft size={18} />
            </IconButton>
            <IconButton
              disabled={!history.fwd.length}
              onClick={() => navigate(history.fwd[history.fwd.length - 1], "fwd")}
              title="Forward"
            >
              <ChevronRight size={18} />
            </IconButton>
            <div className="ml-1 flex min-w-0 flex-1 items-center overflow-x-auto [scrollbar-width:none]">
              {listing?.segments.map((s, i) => {
                const last = i === listing.segments.length - 1;
                const isDrop = dragOver?.side === side && dragOver.rowPath === `crumb:${s.path}`;
                return (
                  <div key={s.path} className="flex shrink-0 items-center">
                    {i > 0 && <ChevronRight size={14} className="mx-0.5 text-faint" />}
                    <button
                      data-drop-dir={s.path}
                      data-drop-row={`crumb:${s.path}`}
                      data-side={side}
                      onClick={() => !last && navigate(s.path)}
                      className={clsx(
                        "flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[13.5px]",
                        last ? "text-fg" : "text-muted hover:bg-hover hover:text-fg",
                        isDrop && "bg-accent/30 text-fg",
                      )}
                    >
                      <Folder size={16} className="fill-folder text-folder" />
                      {s.name}
                    </button>
                  </div>
                );
              })}
            </div>
            {loading && <Spinner className="mr-2 h-3.5 w-3.5 text-faint" />}
          </div>

          {/* Column headers */}
          <div className="flex h-9 shrink-0 items-center border-y border-line/70 bg-chrome text-[12.5px] font-semibold">
            <HeaderCell k="name" sort={sort} setSort={setSort} className="min-w-0 flex-1 pl-7">
              Name
            </HeaderCell>
            <HeaderCell k="modified" sort={sort} setSort={setSort} className="w-[158px] border-l border-line/70">
              Date Modified
            </HeaderCell>
            <HeaderCell k="size" sort={sort} setSort={setSort} className="w-[84px] border-l border-line/70">
              Size
            </HeaderCell>
            <HeaderCell k="kind" sort={sort} setSort={setSort} className="w-[96px] border-l border-line/70">
              Kind
            </HeaderCell>
          </div>

          {/* Rows */}
          <Context.Root>
            <Context.Trigger asChild>
              <div
                ref={listRef}
                tabIndex={0}
                onKeyDown={onKeyDown}
                data-autoscroll
                data-drop-dir={cwd ?? undefined}
                data-side={side}
                onMouseDown={(e) => {
                  if (e.target === e.currentTarget) setSelection([]);
                }}
                onContextMenu={(e) => {
                  const rowEl = (e.target as HTMLElement).closest<HTMLElement>("[data-entry]");
                  const p = rowEl?.dataset.rowPath;
                  if (!p) setSelection([]);
                  else if (!selected.has(p)) selectOnly(p);
                }}
                className={clsx(
                  "min-h-0 flex-1 overflow-y-auto pb-6 outline-none",
                  dropPane && "bg-accent/[0.07] shadow-[inset_0_0_0_2px_var(--color-accent)]",
                )}
              >
                {listError && <div className="p-6 text-center text-[13px] text-danger">{listError}</div>}
                {listing?.parent && !filter && (
                  <div
                    data-drop-dir={listing.parent}
                    data-drop-row={`parent:${listing.parent}`}
                    data-side={side}
                    onDoubleClick={() => navigate(listing.parent!)}
                    className={clsx(
                      "flex h-11 items-center gap-2.5 pl-7 text-[13.5px] text-muted",
                      dragOver?.side === side && dragOver.rowPath === `parent:${listing.parent}` && "bg-accent/25",
                    )}
                  >
                    <Folder size={26} className="fill-folder text-folder" strokeWidth={1.2} />
                    ..
                  </div>
                )}
                {rows.map((row) => (
                  <FileRow
                    key={row.entry.path}
                    row={row}
                    side={side}
                    selected={selected.has(row.entry.path)}
                    expanded={expanded.has(row.entry.path)}
                    loading={loadingDirs.has(row.entry.path)}
                    dropTarget={dropRow === row.entry.path}
                    dimmed={!!dragging && dragging.side === side && dragging.paths.includes(row.entry.path)}
                    renaming={renaming === row.entry.path}
                    onToggle={() => (expanded.has(row.entry.path) ? collapse(row.entry.path) : void expand(row.entry.path))}
                    onClick={(e) => clickRow(e, row)}
                    onDoubleClick={() => open(row)}
                    onPointerDown={(e) => startDrag(e, row)}
                    onRename={(name) => void commitRename(row.entry.path, name)}
                    onCancelRename={() => {
                      setRenaming(null);
                      listRef.current?.focus();
                    }}
                  />
                ))}
                {listing && !rows.length && !listError && (
                  <div className="py-16 text-center text-[13px] text-faint">{filter ? "No matches" : "Empty folder"}</div>
                )}
              </div>
            </Context.Trigger>
            <Context.Content>
              {selection.length > 0 ? (
                <>
                  {selection.length === 1 && leadRow && (
                    <>
                      <Context.Item onSelect={() => open(leadRow)}>
                        <FolderOpen size={15} /> Open
                      </Context.Item>
                      <Context.Item onSelect={() => setPreview(true)}>
                        <Eye size={15} /> Quick Look
                      </Context.Item>
                      <Context.Item onSelect={() => setRenaming(leadRow.entry.path)}>
                        <Pencil size={15} /> Rename
                      </Context.Item>
                    </>
                  )}
                  <Context.Item disabled={!otherPane.source || !otherPane.cwd} onSelect={sendToOther}>
                    <ArrowDownUp size={15} /> {conn.kind === "remote" && otherPane.label === "Local" ? "Download" : otherPane.source ? `Copy to ${otherPane.label}` : "Copy to other pane"}
                  </Context.Item>
                  <Context.Item onSelect={() => navigator.clipboard.writeText(selection.join("\n"))}>
                    <Copy size={15} /> Copy path
                  </Context.Item>
                  <Context.Separator />
                  <Context.Item danger onSelect={() => void remove()}>
                    <Trash2 size={15} /> Delete
                  </Context.Item>
                </>
              ) : (
                <>
                  <Context.Item onSelect={newFolder}>
                    <FolderPlus size={15} /> New Folder
                  </Context.Item>
                  <Context.Item onSelect={() => void refresh()}>
                    <RefreshCw size={15} /> Refresh
                  </Context.Item>
                  <Context.Item onSelect={() => setShowHidden((v) => !v)}>
                    {showHidden ? <EyeOff size={15} /> : <Eye size={15} />} {showHidden ? "Hide" : "Show"} hidden files
                  </Context.Item>
                </>
              )}
            </Context.Content>
          </Context.Root>
        </>
      )}

      {previewEntry && source && <PreviewModal source={source} entry={previewEntry} onClose={() => setPreview(false)} />}
    </div>
  );
}

function HeaderCell({
  k,
  sort,
  setSort,
  className,
  children,
}: {
  k: SortKey;
  sort: { key: SortKey; asc: boolean };
  setSort: (s: { key: SortKey; asc: boolean }) => void;
  className?: string;
  children: ReactNode;
}) {
  const active = sort.key === k;
  return (
    <button
      onClick={() => setSort({ key: k, asc: active ? !sort.asc : true })}
      className={clsx("flex h-full items-center justify-between px-3 text-left hover:bg-hover/50", className)}
    >
      {children}
      {active && (sort.asc ? <ChevronUp size={15} className="text-muted" /> : <ChevronDown size={15} className="text-muted" />)}
    </button>
  );
}

function FileRow({
  row,
  side,
  selected,
  expanded,
  loading,
  dropTarget,
  dimmed,
  renaming,
  onToggle,
  onClick,
  onDoubleClick,
  onPointerDown,
  onRename,
  onCancelRename,
}: {
  row: Row;
  side: Side;
  selected: boolean;
  expanded: boolean;
  loading: boolean;
  dropTarget: boolean;
  dimmed: boolean;
  renaming: boolean;
  onToggle: () => void;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onPointerDown: (e: React.PointerEvent) => void;
  onRename: (name: string) => void;
  onCancelRename: () => void;
}) {
  const { entry, depth } = row;
  return (
    <div
      data-entry
      data-row-path={entry.path}
      data-side={side}
      data-drop-dir={entry.isDir ? entry.path : row.dir}
      data-drop-row={entry.isDir ? entry.path : depth > 0 ? row.dir : undefined}
      data-expandable={entry.isDir && !expanded ? "1" : undefined}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onPointerDown={onPointerDown}
      className={clsx(
        "flex h-11 items-center text-[13.5px]",
        selected ? "bg-accent/85 text-white" : dropTarget ? "bg-accent/30" : "hover:bg-row-hover",
        dropTarget && selected && "ring-2 ring-inset ring-white/60",
        dimmed && "opacity-50",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center pr-2" style={{ paddingLeft: 6 + depth * 18 }}>
        <button
          tabIndex={-1}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          className={clsx(
            "mr-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded",
            !entry.isDir && "invisible",
            selected ? "text-white/90" : "text-faint hover:text-fg",
          )}
        >
          {loading ? <Spinner className="h-3 w-3" /> : <ChevronRight size={14} className={clsx("transition-transform", expanded && "rotate-90")} />}
        </button>
        <EntryIcon entry={entry} expanded={expanded} selected={selected} />
        <div className="ml-2.5 min-w-0 flex-1 leading-tight">
          {renaming ? (
            <RenameInput initial={entry.name} onCommit={onRename} onCancel={onCancelRename} />
          ) : (
            <div className="truncate">{entry.name}</div>
          )}
          {entry.permissions && (
            <div className={clsx("truncate font-mono text-[10.5px]", selected ? "text-white/70" : "text-faint")}>{entry.permissions}</div>
          )}
        </div>
      </div>
      <div className={clsx("w-[158px] shrink-0 truncate px-3", selected ? "text-white/85" : "text-muted")}>{formatDate(entry.modified)}</div>
      <div className={clsx("w-[84px] shrink-0 truncate px-3", selected ? "text-white/85" : "text-muted")}>
        {entry.isDir ? "--" : formatSize(entry.size)}
      </div>
      <div className={clsx("w-[96px] shrink-0 truncate px-3", selected ? "text-white/85" : "text-muted")}>{kindOf(entry)}</div>
    </div>
  );
}

function EntryIcon({ entry, expanded, selected }: { entry: FileEntry; expanded: boolean; selected: boolean }) {
  if (entry.isSymlink && !entry.isDir) return <FileSymlink size={24} className={selected ? "text-white" : "text-folder"} strokeWidth={1.5} />;
  if (entry.isDir)
    return expanded ? (
      <FolderOpen size={26} className="shrink-0 fill-folder/90 text-folder" strokeWidth={1.2} />
    ) : (
      <Folder size={26} className="shrink-0 fill-folder text-folder" strokeWidth={1.2} />
    );
  return <File size={24} className={clsx("shrink-0", selected ? "text-white" : "text-muted")} strokeWidth={1.5} />;
}

function RenameInput({ initial, onCommit, onCancel }: { initial: string; onCommit: (v: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = ref.current!;
    el.focus();
    // Select the name without its extension, like Finder.
    const dot = initial.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial]);
  return (
    <input
      ref={ref}
      defaultValue={initial}
      spellCheck={false}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") onCommit(e.currentTarget.value);
        if (e.key === "Escape") onCancel();
      }}
      onBlur={(e) => onCommit(e.currentTarget.value)}
      className="h-6 w-full rounded bg-app px-1.5 text-[13px] text-fg outline-none ring-2 ring-accent"
    />
  );
}

function EmptyState({ onSelect }: { onSelect: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <div className="mb-6 flex h-[72px] w-[72px] items-center justify-center rounded-2xl bg-raised">
        <FolderOpen size={30} />
      </div>
      <div className="text-[18px] font-semibold">Connect to host</div>
      <p className="mt-2.5 max-w-[300px] text-[14px] leading-relaxed text-muted">Start by connecting to a saved host to manage your files with SFTP.</p>
      <Button className="mt-6 h-10 px-5" onClick={onSelect}>
        Select host
      </Button>
    </div>
  );
}
