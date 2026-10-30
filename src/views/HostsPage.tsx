import clsx from "clsx";
import { ArrowDownAZ, ChevronDown, Clock, FileCode2, FolderOpen, LayoutGrid, List, Pencil, Plus, Server, SquareTerminal, Trash2, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { confirmDialog } from "../components/Dialogs";
import { OsIcon } from "../components/OsIcon";
import { Button, Context, IconButton, Menu } from "../components/ui";
import { api } from "../lib/api";
import { isMac, naturalCompare, parseSshTarget } from "../lib/format";
import { formatAccel } from "../lib/keymap";
import { useSettings } from "../lib/settings";
import type { Host } from "../lib/types";
import { useApp } from "../store";
import { HostEditor } from "./HostEditor";

type Sort = "name" | "recent";

function readPref<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) || fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* storage unavailable */
  }
}

export function HostsPage() {
  const hosts = useApp((s) => s.hosts);
  const openTerminal = useApp((s) => s.openTerminal);
  const openInSftp = useApp((s) => s.openInSftp);
  const refreshHosts = useApp((s) => s.refreshHosts);
  const refreshKeys = useApp((s) => s.refreshKeys);
  const toast = useApp((s) => s.toast);

  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Host | "new" | null>(null);
  const [layout, setLayout] = useState<"grid" | "list">(() => readPref("hosts.layout", "grid"));
  const [sort, setSort] = useState<Sort>(() => readPref("hosts.sort", "name"));

  const adhoc = parseSshTarget(query);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = hosts.filter(
      (h) => !q || adhoc || [h.label, h.hostname, h.username].some((v) => v.toLowerCase().includes(q)),
    );
    return list.sort((a, b) =>
      sort === "recent" ? (b.lastUsed ?? 0) - (a.lastUsed ?? 0) || naturalCompare(a.label, b.label) : naturalCompare(a.label, b.label),
    );
  }, [hosts, query, sort, adhoc]);

  // Local is always listed first, regardless of sort order.
  const q = query.trim().toLowerCase();
  const showLocal = !adhoc && (!q || "local".includes(q));

  const connect = (h: Host) => openTerminal({ kind: "saved", hostId: h.id }, h.label, h.id);
  const openLocal = () => openTerminal({ kind: "local" }, "Local");

  const quickConnect = () => {
    if (adhoc) {
      openTerminal({ kind: "adhoc", ...adhoc }, `${adhoc.username}@${adhoc.hostname}`);
      setQuery("");
    } else if (visible.length === 1) {
      connect(visible[0]);
      setQuery("");
    } else if (q && visible.length === 0 && showLocal) {
      openLocal();
      setQuery("");
    }
  };

  const importConfig = async () => {
    try {
      const n = await api.sshconfigImport();
      await Promise.all([refreshHosts(), refreshKeys()]);
      toast(n ? `Imported ${n} host${n > 1 ? "s" : ""} from ~/.ssh/config` : "No new hosts in ~/.ssh/config", "success");
    } catch (e) {
      toast((e as { message: string }).message, "error");
    }
  };

  const remove = async (h: Host) => {
    if (!(await confirmDialog({ title: `Delete “${h.label}”?`, message: "The saved password is removed from the Keychain too.", confirmLabel: "Delete", danger: true })))
      return;
    await api.hostDelete(h.id);
    await refreshHosts();
  };

  const duplicate = async (h: Host) => {
    const { id: _id, ...rest } = h;
    await api.hostSave({ ...rest, label: `${h.label} copy` });
    await refreshHosts();
  };

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="px-3.5 pt-3.5">
          <div className="flex h-11 items-center rounded-xl bg-input pl-4 pr-1.5">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && quickConnect()}
              spellCheck={false}
              placeholder="Find a host or ssh user@hostname..."
              className="h-full flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
            />
            <Button
              variant={adhoc || (q && (visible.length === 1 || (visible.length === 0 && showLocal))) ? "primary" : "secondary"}
              disabled={!adhoc && !(q && (visible.length === 1 || (visible.length === 0 && showLocal)))}
              onClick={quickConnect}
              className="h-8"
            >
              Connect
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2 px-3.5 py-3">
          <div className="flex">
            <Button onClick={() => setEditing("new")} className="rounded-r-none">
              <Plus size={16} /> New host
            </Button>
            <Menu.Root>
              <Menu.Trigger asChild>
                <Button className="ml-px rounded-l-none px-2">
                  <ChevronDown size={15} />
                </Button>
              </Menu.Trigger>
              <Menu.Content>
                <Menu.Item onSelect={() => setEditing("new")}>
                  <Server size={15} /> New host
                </Menu.Item>
                <Menu.Item onSelect={importConfig}>
                  <FileCode2 size={15} /> Import from ~/.ssh/config
                </Menu.Item>
              </Menu.Content>
            </Menu.Root>
          </div>
          <div className="flex-1" />
          <IconButton
            title={layout === "grid" ? "List view" : "Grid view"}
            onClick={() => {
              const v = layout === "grid" ? "list" : "grid";
              setLayout(v);
              writePref("hosts.layout", v);
            }}
          >
            {layout === "grid" ? <LayoutGrid size={17} /> : <List size={17} />}
          </IconButton>
          <IconButton
            title={sort === "name" ? "Sorted by name" : "Sorted by last used"}
            onClick={() => {
              const v = sort === "name" ? "recent" : "name";
              setSort(v);
              writePref("hosts.sort", v);
            }}
          >
            {sort === "name" ? <ArrowDownAZ size={17} /> : <Clock size={17} />}
          </IconButton>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-app px-6 pb-6 pt-4">
          <h2 className="mb-3 text-[14px] font-semibold">Hosts</h2>
          <div className={clsx(layout === "grid" ? "grid gap-3" : "flex flex-col gap-1.5")} style={layout === "grid" ? { gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" } : undefined}>
            {showLocal && <LocalCard layout={layout} onOpen={openLocal} />}
            {visible.map((h) => (
              <Context.Root key={h.id}>
                <Context.Trigger asChild>
                  <div
                    onClick={() => connect(h)}
                    className={clsx(
                      "group flex cursor-default items-center gap-3.5 rounded-xl bg-panel transition-colors hover:bg-raised",
                      layout === "grid" ? "h-[74px] px-4" : "h-12 px-3",
                      editing !== "new" && editing?.id === h.id && "ring-1 ring-accent",
                    )}
                  >
                    <OsIcon os={h.os} size={layout === "grid" ? 40 : 28} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-medium">{h.label}</div>
                      <div className="truncate text-xs text-muted">ssh{h.username ? `, ${h.username}` : ""}</div>
                    </div>
                    <IconButton
                      title="Edit"
                      className="opacity-0 group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(h);
                      }}
                    >
                      <Pencil size={15} />
                    </IconButton>
                  </div>
                </Context.Trigger>
                <Context.Content>
                  <Context.Item onSelect={() => connect(h)}>
                    <SquareTerminal size={15} /> Connect
                  </Context.Item>
                  <Context.Item onSelect={() => openInSftp(h.id)}>
                    <FolderOpen size={15} /> Open in SFTP
                  </Context.Item>
                  <Context.Separator />
                  <Context.Item onSelect={() => setEditing(h)}>
                    <Pencil size={15} /> Edit
                  </Context.Item>
                  <Context.Item onSelect={() => duplicate(h)}>
                    <Copy size={15} /> Duplicate
                  </Context.Item>
                  <Context.Item danger onSelect={() => remove(h)}>
                    <Trash2 size={15} /> Delete
                  </Context.Item>
                </Context.Content>
              </Context.Root>
            ))}
          </div>
          {hosts.length === 0 && <EmptyHosts onNew={() => setEditing("new")} onImport={importConfig} />}
        </div>
      </div>
      {editing && <HostEditor key={editing === "new" ? "new" : editing.id} host={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function LocalCard({ layout, onOpen }: { layout: "grid" | "list"; onOpen: () => void }) {
  const accel = useSettings((s) => s.settings.shortcuts.bindings.localTerminal);
  return (
    <Context.Root>
      <Context.Trigger asChild>
        <div
          onClick={onOpen}
          className={clsx(
            "group flex cursor-default items-center gap-3.5 rounded-xl bg-panel transition-colors hover:bg-raised",
            layout === "grid" ? "h-[74px] px-4" : "h-12 px-3",
          )}
        >
          <OsIcon os="local" size={layout === "grid" ? 40 : 28} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-medium">Local</div>
            <div className="truncate text-xs text-muted">{isMac ? "Shell on this Mac" : "Shell on this computer"}</div>
          </div>
          {accel && <kbd className="font-sans text-xs text-faint opacity-0 group-hover:opacity-100">{formatAccel(accel)}</kbd>}
        </div>
      </Context.Trigger>
      <Context.Content>
        <Context.Item onSelect={onOpen}>
          <SquareTerminal size={15} /> New terminal
        </Context.Item>
      </Context.Content>
    </Context.Root>
  );
}

function EmptyHosts({ onNew, onImport }: { onNew: () => void; onImport: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-raised">
        <Server size={26} />
      </div>
      <div className="text-[17px] font-semibold">No hosts yet</div>
      <p className="mt-2 max-w-[340px] text-[13px] text-muted">Save a server with its address, user and credentials, or import the hosts from your SSH config.</p>
      <div className="mt-5 flex gap-2">
        <Button variant="primary" onClick={onNew}>
          <Plus size={16} /> New host
        </Button>
        <Button onClick={onImport}>Import ~/.ssh/config</Button>
      </div>
    </div>
  );
}
