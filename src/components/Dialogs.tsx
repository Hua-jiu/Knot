import { listen } from "@tauri-apps/api/event";
import { ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { api } from "../lib/api";
import type { HostKeyInfo } from "../lib/types";
import { Button, Field, Input, Modal } from "./ui";

type Request =
  | { kind: "confirm"; title: string; message: string; confirmLabel: string; danger: boolean; resolve: (ok: boolean) => void }
  | { kind: "prompt"; title: string; label: string; initial: string; confirmLabel: string; resolve: (v: string | null) => void }
  | {
      kind: "password";
      title: string;
      message: string;
      allowSave: boolean;
      resolve: (v: { password: string; save: boolean } | null) => void;
    }
  | { kind: "hostkey"; requestId: string; info: HostKeyInfo };

const useDialogs = create<{ queue: (Request & { seq: number })[] }>(() => ({ queue: [] }));

let seq = 0;
function push(r: Request) {
  useDialogs.setState((s) => ({ queue: [...s.queue, { ...r, seq: ++seq }] }));
}
function pop() {
  useDialogs.setState((s) => ({ queue: s.queue.slice(1) }));
}

export function confirmDialog(opts: { title: string; message: string; confirmLabel?: string; danger?: boolean }) {
  return new Promise<boolean>((resolve) =>
    push({ kind: "confirm", confirmLabel: opts.confirmLabel ?? "OK", danger: !!opts.danger, title: opts.title, message: opts.message, resolve }),
  );
}

export function promptDialog(opts: { title: string; label: string; initial?: string; confirmLabel?: string }) {
  return new Promise<string | null>((resolve) =>
    push({ kind: "prompt", initial: opts.initial ?? "", confirmLabel: opts.confirmLabel ?? "OK", title: opts.title, label: opts.label, resolve }),
  );
}

export function passwordDialog(opts: { title: string; message: string; allowSave: boolean }) {
  return new Promise<{ password: string; save: boolean } | null>((resolve) => push({ kind: "password", ...opts, resolve }));
}

/** Mount once. Renders the head of the dialog queue and listens for host-key prompts from the backend. */
export function DialogHost() {
  const req = useDialogs((s) => s.queue[0]);

  useEffect(() => {
    const un = listen<{ requestId: string; info: HostKeyInfo }>("hostkey-prompt", (e) =>
      push({ kind: "hostkey", requestId: e.payload.requestId, info: e.payload.info }),
    );
    return () => void un.then((f) => f());
  }, []);

  if (!req) return null;
  // Keyed by sequence so each request gets fresh local state.
  switch (req.kind) {
    case "confirm":
      return <ConfirmView key={req.seq} req={req} />;
    case "prompt":
      return <PromptView key={req.seq} req={req} />;
    case "password":
      return <PasswordView key={req.seq} req={req} />;
    case "hostkey":
      return <HostKeyView key={req.seq} req={req} />;
  }
}

function ConfirmView({ req }: { req: Extract<Request, { kind: "confirm" }> }) {
  const done = (ok: boolean) => {
    pop();
    req.resolve(ok);
  };
  return (
    <Modal
      open
      onClose={() => done(false)}
      title={req.title}
      footer={
        <>
          <Button onClick={() => done(false)}>Cancel</Button>
          <Button autoFocus variant={req.danger ? "danger" : "primary"} onClick={() => done(true)}>
            {req.confirmLabel}
          </Button>
        </>
      }
    >
      <p className="selectable whitespace-pre-wrap break-words text-[13px] leading-relaxed text-muted">{req.message}</p>
    </Modal>
  );
}

function PromptView({ req }: { req: Extract<Request, { kind: "prompt" }> }) {
  const [value, setValue] = useState(req.initial);
  const done = (v: string | null) => {
    pop();
    req.resolve(v);
  };
  return (
    <Modal open onClose={() => done(null)} title={req.title}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) done(value.trim());
        }}
      >
        <Field label={req.label}>
          <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} onFocus={(e) => e.target.select()} />
        </Field>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" onClick={() => done(null)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!value.trim()}>
            {req.confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function PasswordView({ req }: { req: Extract<Request, { kind: "password" }> }) {
  const [password, setPassword] = useState("");
  const [save, setSave] = useState(true);
  const done = (v: { password: string; save: boolean } | null) => {
    pop();
    req.resolve(v);
  };
  return (
    <Modal open onClose={() => done(null)} title={req.title}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          done({ password, save: req.allowSave && save });
        }}
      >
        <p className="mb-4 text-[13px] text-muted">{req.message}</p>
        <Field label="Password">
          <Input autoFocus type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {req.allowSave && (
          <label className="mt-3 flex items-center gap-2 text-[13px] text-muted">
            <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} className="accent-accent" />
            Save to Keychain
          </label>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" onClick={() => done(null)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Connect
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function HostKeyView({ req }: { req: Extract<Request, { kind: "hostkey" }> }) {
  const answer = (accept: boolean) => {
    pop();
    void api.hostkeyRespond(req.requestId, accept);
  };
  const { host, port, algorithm, fingerprint } = req.info;
  return (
    <Modal
      open
      onClose={() => answer(false)}
      width={500}
      title={
        <span className="flex items-center gap-2">
          <ShieldAlert size={18} className="text-amber-400" /> Unknown host
        </span>
      }
      footer={
        <>
          <Button onClick={() => answer(false)}>Cancel</Button>
          <Button variant="primary" autoFocus onClick={() => answer(true)}>
            Trust & Connect
          </Button>
        </>
      }
    >
      <p className="text-[13px] leading-relaxed text-muted">
        The authenticity of <span className="text-fg">{port === 22 ? host : `[${host}]:${port}`}</span> can't be established.
        Check that the fingerprint matches the server before continuing.
      </p>
      <div className="selectable mt-4 rounded-xl bg-input p-3 font-mono text-xs leading-relaxed">
        <div className="text-muted">{algorithm}</div>
        <div className="break-all text-fg">{fingerprint}</div>
      </div>
    </Modal>
  );
}
