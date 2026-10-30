import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { DialogHost } from "./components/Dialogs";
import { TitleBar } from "./components/TitleBar";
import { Toasts } from "./components/Toasts";
import { applyAppearance, useSettings } from "./lib/settings";
import { useGlobalShortcuts } from "./lib/shortcuts";
import { useApp } from "./store";
import { SftpView } from "./views/SftpView";
import { PaneDragGhost, TerminalLayer } from "./views/TerminalLayer";
import { VaultView } from "./views/VaultView";

export default function App() {
  const tabs = useApp((s) => s.tabs);
  const active = useApp((s) => s.activeTab);
  const settings = useSettings((s) => s.settings);
  const mode = useSettings((s) => s.mode);

  useEffect(() => applyAppearance(settings, mode), [settings, mode]);
  useGlobalShortcuts();

  useEffect(() => {
    const { refreshHosts, refreshKeys, toast } = useApp.getState();
    Promise.all([refreshHosts(), refreshKeys()]).catch((e) => toast(String(e.message ?? e), "error"));
    const un = listen("hosts-changed", () => void useApp.getState().refreshHosts());
    // Keep the webview from navigating when something is dropped outside a drop zone.
    const stop = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => {
      void un.then((f) => f());
      window.removeEventListener("dragover", stop);
      window.removeEventListener("drop", stop);
    };
  }, []);

  return (
    <div className="flex h-full flex-col" onContextMenu={(e) => {
        // Keep the native menu (copy / paste) only where text is editable or selectable.
        if (!(e.target as HTMLElement).closest("input, textarea, .selectable")) e.preventDefault();
      }}>
      <TitleBar />
      <div className="relative min-h-0 flex-1">
        {/* Vault and SFTP stay mounted so their state survives tab switches. */}
        {tabs.map(
          (t) =>
            t.kind !== "terminal" && (
              <div key={t.id} className="absolute inset-0" style={{ display: t.id === active ? "block" : "none" }}>
                {t.kind === "vault" ? <VaultView /> : <SftpView />}
              </div>
            ),
        )}
        <TerminalLayer />
      </div>
      <PaneDragGhost />
      <DialogHost />
      <Toasts />
    </div>
  );
}
