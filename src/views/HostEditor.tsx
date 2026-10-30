import { Eye, EyeOff, KeyRound, Trash2, X } from "lucide-react";
import { useState } from "react";
import { confirmDialog } from "../components/Dialogs";
import { OsIcon } from "../components/OsIcon";
import { Button, Field, IconButton, Input } from "../components/ui";
import { api } from "../lib/api";
import type { Host } from "../lib/types";
import { useApp } from "../store";
import { KeyImportDialog } from "./KeychainPage";

/** Right-hand drawer for creating / editing a host. */
export function HostEditor({ host, onClose }: { host: Host | null; onClose: () => void }) {
  const keys = useApp((s) => s.keys);
  const refreshHosts = useApp((s) => s.refreshHosts);
  const toast = useApp((s) => s.toast);

  const [label, setLabel] = useState(host?.label ?? "");
  const [hostname, setHostname] = useState(host?.hostname ?? "");
  const [port, setPort] = useState(String(host?.port ?? 22));
  const [username, setUsername] = useState(host?.username ?? "");
  const [keyId, setKeyId] = useState(host?.keyId ?? "");
  // undefined = unchanged; "" with clearPassword = remove.
  const [password, setPassword] = useState<string | undefined>(undefined);
  const [clearPassword, setClearPassword] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);

  const portNum = Number(port);
  const valid = hostname.trim() && Number.isInteger(portNum) && portNum > 0 && portNum < 65536;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await api.hostSave({
        id: host?.id,
        label,
        hostname,
        port: portNum,
        username,
        keyId: keyId || null,
        password: clearPassword ? "" : password || undefined,
      });
      await refreshHosts();
      onClose();
    } catch (e) {
      toast((e as { message: string }).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!host) return;
    if (!(await confirmDialog({ title: `Delete “${host.label}”?`, message: "This cannot be undone.", confirmLabel: "Delete", danger: true }))) return;
    await api.hostDelete(host.id);
    await refreshHosts();
    onClose();
  };

  const storedPw = host?.hasPassword && !clearPassword && password === undefined;

  return (
    <aside className="animate-in flex w-[360px] shrink-0 flex-col border-l border-line bg-chrome">
      <div className="flex h-14 items-center justify-between border-b border-line/70 px-5">
        <div className="flex items-center gap-2.5 text-[14px] font-semibold">
          <OsIcon os={host?.os} size={26} />
          {host ? "Edit host" : "New host"}
        </div>
        <IconButton onClick={onClose} aria-label="Close">
          <X size={16} />
        </IconButton>
      </div>

      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <Section title="General">
            <Field label="Label">
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. prod-web-1" autoFocus={!host} />
            </Field>
            <div className="flex gap-2">
              <div className="flex-1">
                <Field label="Address">
                  <Input value={hostname} onChange={(e) => setHostname(e.target.value)} placeholder="IP or hostname" />
                </Field>
              </div>
              <div className="w-[84px]">
                <Field label="Port">
                  <Input value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))} inputMode="numeric" />
                </Field>
              </div>
            </div>
          </Section>

          <Section title="Credentials">
            <Field label="Username">
              <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="root" />
            </Field>
            <Field
              label="Password"
              hint={
                storedPw ? (
                  <span className="flex items-center justify-between">
                    Stored in the system Keychain
                    <button type="button" className="text-danger hover:underline" onClick={() => setClearPassword(true)}>
                      Remove
                    </button>
                  </span>
                ) : clearPassword ? (
                  <span>
                    Will be removed on save ·{" "}
                    <button type="button" className="text-accent hover:underline" onClick={() => setClearPassword(false)}>
                      Undo
                    </button>
                  </span>
                ) : undefined
              }
            >
              <div className="relative">
                <Input
                  type={showPw ? "text" : "password"}
                  value={password ?? ""}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setClearPassword(false);
                  }}
                  placeholder={storedPw ? "••••••••" : "Optional"}
                  className="pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-faint hover:text-fg"
                  tabIndex={-1}
                >
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </Field>
            <Field label="Key" hint={!keyId ? "Without a key, the SSH agent and ~/.ssh/id_* are tried automatically." : undefined}>
              <div className="flex gap-2">
                <select
                  value={keyId}
                  onChange={(e) => setKeyId(e.target.value)}
                  className="h-9 flex-1 rounded-lg bg-input px-2.5 text-[13px] text-fg outline-none focus:ring-1 focus:ring-accent/60"
                >
                  <option value="">None</option>
                  {keys.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.label} ({k.algorithm.replace("ssh-", "")})
                    </option>
                  ))}
                </select>
                <IconButton type="button" title="Import a key" onClick={() => setImporting(true)} className="h-9 w-9 bg-input">
                  <KeyRound size={15} />
                </IconButton>
              </div>
            </Field>
          </Section>
        </div>

        <div className="flex gap-2 border-t border-line/70 p-4">
          {host && (
            <IconButton type="button" title="Delete host" onClick={remove} className="h-9 w-9 hover:text-danger">
              <Trash2 size={16} />
            </IconButton>
          )}
          <div className="flex-1" />
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!valid || saving}>
            Save
          </Button>
        </div>
      </form>
      {importing && (
        <KeyImportDialog
          mode="paste"
          onClose={(k) => {
            setImporting(false);
            if (k) setKeyId(k.id);
          }}
        />
      )}
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl bg-panel p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-faint">{title}</h3>
      {children}
    </section>
  );
}
