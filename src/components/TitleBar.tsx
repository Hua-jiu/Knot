import clsx from "clsx";
import { Columns2, FolderOpen, LayoutGrid, LayoutPanelLeft, Pencil, Plus, ShieldCheck, SquareSplitHorizontal, X } from "lucide-react";
import type { ReactNode } from "react";
import { isMac } from "../lib/format";
import { formatAccel } from "../lib/keymap";
import { beginPaneDrag, consumeDragClick, usePaneDrag } from "../lib/paneDrag";
import { leaves } from "../lib/panes";
import { useSettings } from "../lib/settings";
import { terminalCommands } from "../lib/shortcuts";
import { focusedSession, useApp, type Tab, type TerminalTab } from "../store";
import { promptDialog } from "./Dialogs";
import { HostPicker } from "./HostPicker";
import { SessionIcon } from "./SessionIcon";
import { Context } from "./ui";

const WORKSPACE_ICONS = [Columns2, Columns2, Columns2, LayoutPanelLeft, LayoutGrid];

async function renameWorkspace(tab: TerminalTab) {
  const name = await promptDialog({ title: "Rename workspace", label: "Name", initial: tab.name ?? "Workspace", confirmLabel: "Rename" });
  if (name != null) useApp.getState().renameTab(tab.id, name);
}

export function TitleBar() {
  const tabs = useApp((s) => s.tabs);
  const active = useApp((s) => s.activeTab);
  const openTerminal = useApp((s) => s.openTerminal);
  const pickerOpen = useApp((s) => s.pickerOpen);
  const setPickerOpen = useApp((s) => s.setPickerOpen);
  const pickerKey = useSettings((s) => s.settings.shortcuts.bindings.openHosts);
  const detaching = usePaneDrag((s) => s.over?.kind === "detach");

  return (
    <div
      data-tauri-drag-region
      data-tab-strip
      className="flex h-[52px] shrink-0 items-center gap-1.5 border-b border-line/70 bg-chrome pr-3"
      style={{ paddingLeft: isMac ? 84 : 12 }}
    >
      {tabs.map((t) => (t.kind === "terminal" ? <TerminalTabButton key={t.id} tab={t} active={t.id === active} /> : <AppTabButton key={t.id} tab={t} active={t.id === active} />))}
      {detaching && (
        <div className="glass animate-in flex h-9 w-[150px] shrink-0 items-center gap-2 rounded-lg px-3.5 text-[13px] font-medium">
          <Plus size={15} /> New tab
        </div>
      )}
      <HostPicker
        includeLocal
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onCloseAutoFocus={(e) => {
          // Return to the terminal the picker was opened from instead of the + button.
          const cmds = terminalCommands.get(focusedSession() ?? "");
          if (cmds) {
            e.preventDefault();
            cmds.focus();
          }
        }}
        onPick={(r) => {
          if (r.kind === "local") openTerminal({ kind: "local" }, "Local");
          else if (r.kind === "host") openTerminal({ kind: "saved", hostId: r.host.id }, r.host.label, r.host.id);
          else if (r.kind === "adhoc") openTerminal({ kind: "adhoc", hostname: r.hostname, port: r.port, username: r.username }, `${r.username}@${r.hostname}`);
        }}
      >
        <button
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-fg"
          title={pickerKey ? `New terminal (${formatAccel(pickerKey)})` : "New terminal"}
        >
          <Plus size={18} />
        </button>
      </HostPicker>
      <div data-tauri-drag-region className="h-full flex-1" />
    </div>
  );
}

function AppTabButton({ tab, active }: { tab: Tab; active: boolean }) {
  const setActive = useApp((s) => s.setActive);
  return (
    <TabShell tab={tab} active={active} onClick={() => setActive(tab.id)} className={tab.kind === "vault" ? "w-[150px]" : "w-[120px]"}>
      {tab.kind === "vault" ? <ShieldCheck size={16} /> : <FolderOpen size={16} />}
      {tab.kind === "vault" ? "Vault" : "SFTP"}
    </TabShell>
  );
}

function TerminalTabButton({ tab, active }: { tab: TerminalTab; active: boolean }) {
  const setActive = useApp((s) => s.setActive);
  const closeTab = useApp((s) => s.closeTab);
  const ungroup = useApp((s) => s.ungroup);
  const session = useApp((s) => s.sessions[tab.focus]);
  const ids = leaves(tab.root);
  const workspace = ids.length > 1;
  const Icon = WORKSPACE_ICONS[ids.length] ?? LayoutGrid;

  return (
    <Context.Root>
      <Context.Trigger asChild>
        <TabShell
          tab={tab}
          active={active}
          className="w-[180px]"
          onClick={() => !consumeDragClick() && setActive(tab.id)}
          onClose={() => closeTab(tab.id)}
          // A single session can be dragged onto another terminal to split it.
          onPointerDown={(e) => e.button === 0 && !workspace && !(e.target as HTMLElement).closest("button") && beginPaneDrag(e, tab.focus)}
          onDoubleClick={() => workspace && void renameWorkspace(tab)}
        >
          {workspace ? <Icon size={16} className="shrink-0" /> : <SessionIcon session={session} />}
          <span className="truncate">{workspace ? (tab.name ?? "Workspace") : session?.title}</span>
          {workspace && <span className="shrink-0 rounded bg-hover px-1 text-[10.5px] tabular-nums text-muted">{ids.length}</span>}
        </TabShell>
      </Context.Trigger>
      <Context.Content>
        {workspace && (
          <>
            <Context.Item onSelect={() => void renameWorkspace(tab)}>
              <Pencil size={15} /> Rename…
            </Context.Item>
            <Context.Item onSelect={() => ungroup(tab.id)}>
              <SquareSplitHorizontal size={15} /> Move panes to separate tabs
            </Context.Item>
            <Context.Separator />
          </>
        )}
        <Context.Item danger onSelect={() => closeTab(tab.id)}>
          <X size={15} /> {workspace ? `Close workspace (${ids.length} sessions)` : "Close tab"}
        </Context.Item>
      </Context.Content>
    </Context.Root>
  );
}

function TabShell({
  tab,
  active,
  className,
  onClick,
  onClose,
  children,
  ...rest
}: {
  tab: Tab;
  active: boolean;
  className: string;
  onClick: () => void;
  onClose?: () => void;
  children: ReactNode;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "onClick" | "children" | "className">) {
  return (
    <div
      {...rest}
      data-tab-id={tab.id}
      data-tab-kind={tab.kind}
      onMouseDown={(e) => {
        if (e.button === 1 && onClose) onClose();
      }}
      onClick={onClick}
      className={clsx(
        "group flex h-9 min-w-0 cursor-default items-center gap-2 rounded-lg px-3.5 text-[13.5px] font-medium transition-colors",
        className,
        active ? "bg-raised text-fg" : "text-muted hover:bg-hover/60 hover:text-fg",
      )}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
      {onClose && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-faint opacity-0 hover:bg-hover hover:text-fg group-hover:opacity-100"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}
