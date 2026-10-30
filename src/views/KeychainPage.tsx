import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import clsx from "clsx";
import { ChevronDown, Copy, FileKey, KeyRound, Plus, Sparkles, Trash2, X, ClipboardPaste } from "lucide-react";
import { useState } from "react";
import { confirmDialog } from "../components/Dialogs";
import { Button, Field, IconButton, Input, Menu, Modal } from "../components/ui";
import { api } from "../lib/api";
import type { KeyEntry } from "../lib/types";
import { useApp } from "../store";

type ImportMode = "paste" | "file" | "generate";

export function KeychainPage() {
  const keys = useApp((s) => s.keys);
  const [mode, setMode] = useState<ImportMode | null>(null);
  const [selected, setSelected] = useState<KeyEntry | null>(null);

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 px-3.5 py-3.5">
          <div className="flex">
            <Button onClick={() => setMode("paste")} className="rounded-r-none">
              <Plus size={16} /> Key
            </Button>
            <Menu.Root>
              <Menu.Trigger asChild>
                <Button className="ml-px rounded-l-none px-2">
                  <ChevronDown size={15} />
                </Button>
              </Menu.Trigger>
              <Menu.Content>
                <Menu.Item onSelect={() => setMode("paste")}>
                  <ClipboardPaste size={15} /> Paste private key
                </Menu.Item>
                <Menu.Item onSelect={() => setMode("file")}>
                  <FileKey size={15} /> Import from file
                </Menu.Item>
                <Menu.Item onSelect={() => setMode("generate")}>
                  <Sparkles size={15} /> Generate Ed25519 key
                </Menu.Item>
              </Menu.Content>
            </Menu.Root>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4">
          <h2 className="mb-3 text-[14px] font-semibold">Keys</h2>
          {keys.length === 0 ? (
            <div className="flex flex-col items-center py-24 text-center">
              <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-raised">
                <KeyRound size={26} />
              </div>
              <div className="text-[17px] font-semibold">No keys yet</div>
              <p className="mt-2 max-w-[340px] text-[13px] text-muted">
                Import an existing private key or generate a new one. Passphrases are kept in the system Keychain.
              </p>
              <div className="mt-5 flex gap-2">
                <Button variant="primary" onClick={() => setMode("file")}>
                  Import key
                </Button>
                <Button onClick={() => setMode("generate")}>Generate</Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
              {keys.map((k) => (
                <button
                  key={k.id}
                  onClick={() => setSelected(k)}
                  className={clsx(
                    "flex h-[74px] items-center gap-3.5 rounded-xl bg-panel px-4 text-left transition-colors hover:bg-raised",
                    selected?.id === k.id && "ring-1 ring-accent",
                  )}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[9px] bg-key-bg text-key-fg">
                    <KeyRound size={19} />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-medium">{k.label}</div>
                    <div className="truncate text-xs text-muted">
                      {k.algorithm.replace("ssh-", "")} · {k.fingerprint.replace("SHA256:", "").slice(0, 16)}…
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {selected && <KeyDetail key={selected.id} entry={selected} onClose={() => setSelected(null)} />}
      {mode && <KeyImportDialog mode={mode} onClose={() => setMode(null)} />}
    </div>
  );
}

function KeyDetail({ entry, onClose }: { entry: KeyEntry; onClose: () => void }) {
  const hosts = useApp((s) => s.hosts);
  const refreshKeys = useApp((s) => s.refreshKeys);
  const refreshHosts = useApp((s) => s.refreshHosts);
  const toast = useApp((s) => s.toast);
  const [label, setLabel] = useState(entry.label);
  const usedBy = hosts.filter((h) => h.keyId === entry.id);

  const copyPublic = async () => {
    await navigator.clipboard.writeText(entry.publicKey);
    toast("Public key copied", "success");
  };

  const remove = async () => {
    const msg = usedBy.length
      ? `Used by ${usedBy.map((h) => h.label).join(", ")}. Those hosts will no longer use a key.`
      : entry.managed
        ? "The private key stored in Knot will be deleted."
        : `Only the reference is removed; ${entry.path} stays on disk.`;
    if (!(await confirmDialog({ title: `Delete “${entry.label}”?`, message: msg, confirmLabel: "Delete", danger: true }))) return;
    await api.keyDelete(entry.id);
    await Promise.all([refreshKeys(), refreshHosts()]);
    onClose();
  };

  const rename = async () => {
    if (label.trim() && label !== entry.label) {
      await api.keyRename(entry.id, label);
      await refreshKeys();
    }
  };

  return (
    <aside className="animate-in flex w-[380px] shrink-0 flex-col border-l border-line bg-chrome">
      <div className="flex h-14 items-center justify-between border-b border-line/70 px-5">
        <div className="text-[14px] font-semibold">Key</div>
        <IconButton onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        <Field label="Label">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} onBlur={rename} onKeyDown={(e) => e.key === "Enter" && rename()} />
        </Field>
        <Info label="Type" value={entry.algorithm} />
        <Info label="Fingerprint" value={entry.fingerprint} mono />
        <Info label="Location" value={entry.managed ? "Stored by Knot" : entry.path} mono={!entry.managed} />
        <Info label="Passphrase" value={entry.encrypted ? (entry.hasPassphrase ? "Saved in Keychain" : "Encrypted — not saved") : "None"} />
        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-muted">
            Public key
            <button onClick={copyPublic} className="flex items-center gap-1 text-accent hover:underline">
              <Copy size={12} /> Copy
            </button>
          </div>
          <div className="selectable break-all rounded-lg bg-input p-3 font-mono text-[11px] leading-relaxed text-muted">{entry.publicKey}</div>
        </div>
        {usedBy.length > 0 && <Info label="Used by" value={usedBy.map((h) => h.label).join(", ")} />}
      </div>
      <div className="flex border-t border-line/70 p-4">
        <Button variant="danger" onClick={remove}>
          <Trash2 size={15} /> Delete key
        </Button>
      </div>
    </aside>
  );
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted">{label}</div>
      <div className={clsx("selectable break-all text-[13px]", mono && "font-mono text-xs")}>{value}</div>
    </div>
  );
}

export function KeyImportDialog({ mode: initial, onClose }: { mode: ImportMode; onClose: (k?: KeyEntry) => void }) {
  const refreshKeys = useApp((s) => s.refreshKeys);
  const [mode, setMode] = useState<ImportMode>(initial);
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");
  const [path, setPath] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pickFile = async () => {
    const sel = await openFileDialog({ multiple: false, directory: false, title: "Choose a private key" });
    if (typeof sel === "string") {
      setPath(sel);
      if (!label) setLabel(sel.split(/[\\/]/).pop() ?? "");
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const k =
        mode === "generate"
          ? await api.keyGenerate(label, passphrase || undefined)
          : await api.keyImport({
              label,
              privateKey: mode === "paste" ? text : undefined,
              path: mode === "file" ? path : undefined,
              passphrase: passphrase || undefined,
            });
      await refreshKeys();
      onClose(k);
    } catch (e) {
      setError((e as { message: string }).message);
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = mode === "generate" || (mode === "paste" ? text.trim() : path.trim());

  return (
    <Modal open onClose={() => onClose()} title="Add key" width={500}>
      <div className="mb-4 flex rounded-lg bg-input p-0.5 text-[13px]">
        {(["paste", "file", "generate"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={clsx("h-7 flex-1 rounded-md", mode === m ? "bg-raised text-fg" : "text-muted hover:text-fg")}
          >
            {m === "paste" ? "Paste" : m === "file" ? "File" : "Generate"}
          </button>
        ))}
      </div>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) void submit();
        }}
      >
        <Field label="Label">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={mode === "generate" ? "ed25519" : "My key"} />
        </Field>
        {mode === "paste" && (
          <Field label="Private key">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
              className="h-36 w-full resize-none rounded-lg bg-input p-3 font-mono text-[11px] text-fg outline-none placeholder:text-faint focus:ring-1 focus:ring-accent/60"
            />
          </Field>
        )}
        {mode === "file" && (
          <Field label="Key file" hint="The file is referenced in place, not copied.">
            <div className="flex gap-2">
              <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="~/.ssh/id_ed25519" />
              <Button type="button" onClick={pickFile}>
                Browse…
              </Button>
            </div>
          </Field>
        )}
        <Field label={mode === "generate" ? "Passphrase (optional)" : "Passphrase (if encrypted)"} hint="Saved in the system Keychain.">
          <Input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
        </Field>
        {error && <div className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" onClick={() => onClose()}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!canSubmit || busy}>
            {mode === "generate" ? "Generate" : "Import"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
