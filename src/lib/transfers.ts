import { Channel } from "@tauri-apps/api/core";
import { create } from "zustand";
import { confirmDialog } from "../components/Dialogs";
import { useApp } from "../store";
import { useSettings } from "./settings";
import { api, toApiError } from "./api";
import type { Source, TransferEvent } from "./types";

/** Panes watch this counter and reload when a transfer they may show has finished. */
export const useFsVersion = create<{ version: number; bump(): void }>((set) => ({
  version: 0,
  bump: () => set((s) => ({ version: s.version + 1 })),
}));

const backendIds = new Map<string, string>();
let seq = 0;

export function cancelTransfer(clientId: string) {
  const id = backendIds.get(clientId);
  if (id) void api.transferCancel(id);
}

/** Copy `paths` into `dir` on another file system, asking before replacing existing items. */
export async function startTransfer(opts: {
  from: Source;
  fromLabel: string;
  paths: string[];
  to: Source;
  toLabel: string;
  dir: string;
}) {
  const { from, to, paths, dir } = opts;
  const app = useApp.getState();
  const name = paths.length === 1 ? paths[0].split(/[\\/]/).filter(Boolean).pop()! : `${paths.length} items`;
  const direction = `${opts.fromLabel} → ${opts.toLabel}`;

  const run = async (overwrite: boolean): Promise<void> => {
    const clientId = `t${++seq}`;
    const channel = new Channel<TransferEvent>();
    channel.onmessage = (ev) => {
      const s = useApp.getState();
      const cur = s.transfers.find((t) => t.id === clientId);
      if (!cur) return;
      if (ev.type === "progress") {
        s.upsertTransfer({ ...cur, progress: ev });
      } else if (ev.type === "done") {
        s.upsertTransfer({ ...cur, status: "done" });
        useFsVersion.getState().bump();
        backendIds.delete(clientId);
        setTimeout(() => useApp.getState().removeTransfer(clientId), 2500);
      } else {
        const cancelled = ev.error.code === "cancelled";
        s.upsertTransfer({ ...cur, status: cancelled ? "cancelled" : "failed", error: ev.error.message });
        useFsVersion.getState().bump();
        backendIds.delete(clientId);
        if (!cancelled) s.toast(`Transfer of ${name} failed: ${ev.error.message}`, "error");
        setTimeout(() => useApp.getState().removeTransfer(clientId), cancelled ? 1500 : 6000);
      }
    };
    app.upsertTransfer({ id: clientId, label: name, direction, progress: null, status: "running" });
    try {
      backendIds.set(clientId, await api.fsTransfer(from, paths, to, dir, overwrite, channel));
    } catch (e) {
      app.removeTransfer(clientId);
      const err = toApiError(e);
      if (err.code === "exists" && !overwrite) {
        const ok = await confirmDialog({
          title: "Replace existing items?",
          message: `${err.message} in “${opts.toLabel}”. Replace it? Folders are merged.`,
          confirmLabel: "Replace",
          danger: true,
        });
        if (ok) return run(true);
        return;
      }
      app.toast(err.message, "error");
    }
  };
  await run(useSettings.getState().settings.sftp.onConflict === "overwrite");
}
