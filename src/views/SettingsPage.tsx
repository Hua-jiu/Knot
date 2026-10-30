import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import clsx from "clsx";
import { Check, FolderOpen, Minus, Monitor, Moon, Plus, Sun, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { confirmDialog } from "../components/Dialogs";
import { Button } from "../components/ui";
import { isMac } from "../lib/format";
import {
  SHORTCUT_ACTIONS,
  SHORTCUT_PRESETS,
  accelParts,
  accelProblem,
  eventAccel,
  formatAccel,
  matchingPreset,
  normalize,
  presetShortcuts,
  usedByTabNumbers,
  type ShortcutAction,
} from "../lib/keymap";
import {
  ACCENTS,
  DEFAULT_SETTINGS,
  TERMINAL_FONTS,
  TERMINAL_THEMES,
  UI_FONTS,
  fontInstalled,
  terminalFontStack,
  terminalTheme,
  useSettings,
  type AccentId,
  type Appearance,
  type Settings,
} from "../lib/settings";
import { shortcutRecorder } from "../lib/shortcuts";

type Section = "general" | "terminal" | "sftp" | "connection" | "shortcuts" | "about";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "general", label: "General" },
  { id: "terminal", label: "Terminal" },
  { id: "sftp", label: "SFTP" },
  { id: "connection", label: "Connection" },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "about", label: "About" },
];

export function SettingsPage() {
  const [section, setSection] = useState<Section>("general");
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[60px] shrink-0 items-center gap-1 border-b border-line/70 px-6">
        <h1 className="mr-6 text-[15px] font-semibold">Settings</h1>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            className={clsx(
              "h-8 rounded-lg px-3 text-[13px] font-medium transition-colors",
              section === s.id ? "bg-raised text-fg" : "text-muted hover:bg-hover/60 hover:text-fg",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[760px] px-8 py-7">
          {section === "general" && <General />}
          {section === "terminal" && <TerminalSettings />}
          {section === "sftp" && <SftpSettings />}
          {section === "connection" && <ConnectionSettings />}
          {section === "shortcuts" && <ShortcutSettings />}
          {section === "about" && <About />}
        </div>
      </div>
    </div>
  );
}

// ===== sections =====

function General() {
  const g = useSettings((s) => s.settings.general);
  const update = useSettings((s) => s.update);
  const set = (patch: Partial<Settings["general"]>) => update({ general: patch });
  const fonts = useMemo(() => UI_FONTS.map((f) => ({ ...f, ok: f.id === "system" || fontInstalled(f.id) })), []);

  return (
    <>
      <Group title="Appearance" onReset={() => useSettings.getState().reset("general")}>
        <div className="grid grid-cols-3 gap-3 p-4">
          {(
            [
              { id: "system", label: "Auto", hint: "Match system", icon: <Monitor size={14} /> },
              { id: "light", label: "Light", hint: "Always light", icon: <Sun size={14} /> },
              { id: "dark", label: "Dark", hint: "Always dark", icon: <Moon size={14} /> },
            ] as { id: Appearance; label: string; hint: string; icon: ReactNode }[]
          ).map((o) => (
            <button
              key={o.id}
              onClick={() => set({ appearance: o.id })}
              className={clsx(
                "rounded-xl border-2 p-2 text-left transition-colors",
                g.appearance === o.id ? "border-accent" : "border-transparent hover:border-line",
              )}
            >
              <AppearancePreview mode={o.id} />
              <div className="mt-2 flex items-center gap-1.5 px-1 text-[13px] font-medium">
                {o.icon} {o.label}
              </div>
              <div className="px-1 text-[11px] text-faint">{o.hint}</div>
            </button>
          ))}
        </div>
        <Row label="Accent color">
          <div className="flex gap-2">
            {(Object.keys(ACCENTS) as AccentId[]).map((id) => (
              <button
                key={id}
                title={id}
                onClick={() => set({ accent: id })}
                className="flex h-6 w-6 items-center justify-center rounded-full ring-offset-2 ring-offset-panel transition-shadow"
                style={{ background: ACCENTS[id], boxShadow: g.accent === id ? `0 0 0 2px var(--color-panel), 0 0 0 4px ${ACCENTS[id]}` : undefined }}
              >
                {g.accent === id && <Check size={13} className="text-white" strokeWidth={3} />}
              </button>
            ))}
          </div>
        </Row>
      </Group>

      <Group title="Interface">
        <Row label="Font" hint="Used for menus, lists and dialogs.">
          <Select value={g.uiFont} onChange={(v) => set({ uiFont: v })}>
            {fonts.map((f) => (
              <option key={f.id} value={f.id} disabled={!f.ok}>
                {f.label}
                {f.ok ? "" : " (not installed)"}
              </option>
            ))}
          </Select>
        </Row>
        <Row label="Interface size">
          <Segmented
            value={String(g.uiScale)}
            onChange={(v) => set({ uiScale: Number(v) })}
            options={[
              { value: "0.9", label: "Small" },
              { value: "1", label: "Default" },
              { value: "1.1", label: "Large" },
              { value: "1.2", label: "Larger" },
            ]}
          />
        </Row>
      </Group>
    </>
  );
}

function TerminalSettings() {
  const t = useSettings((s) => s.settings.terminal);
  const mode = useSettings((s) => s.mode);
  const update = useSettings((s) => s.update);
  const set = (patch: Partial<Settings["terminal"]>) => update({ terminal: patch });
  const fonts = useMemo(() => {
    const list = TERMINAL_FONTS.map((f) => ({ id: f, ok: fontInstalled(f) }));
    return list.some((f) => f.id === t.fontFamily) ? list : [{ id: t.fontFamily, ok: true }, ...list];
  }, [t.fontFamily]);

  return (
    <>
      <TerminalPreview />
      <Group title="Text" onReset={() => useSettings.getState().reset("terminal")}>
        <Row label="Font">
          <Select value={t.fontFamily} onChange={(v) => set({ fontFamily: v })}>
            {fonts.map((f) => (
              <option key={f.id} value={f.id} disabled={!f.ok}>
                {f.id}
                {f.ok ? "" : " (not installed)"}
              </option>
            ))}
          </Select>
        </Row>
        <Row label="Font size">
          <Stepper value={t.fontSize} min={9} max={28} step={1} format={(v) => `${v} pt`} onChange={(v) => set({ fontSize: v })} />
        </Row>
        <Row label="Line height">
          <Stepper value={t.lineHeight} min={1} max={1.8} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => set({ lineHeight: v })} />
        </Row>
      </Group>

      <Group title="Color scheme">
        <div className="grid grid-cols-4 gap-3 p-4">
          <ThemeTile id="auto" label="Match app" theme={terminalTheme({ ...t, theme: "auto" }, mode)} active={t.theme === "auto"} onClick={() => set({ theme: "auto" })} />
          {Object.entries(TERMINAL_THEMES).map(([id, th]) => (
            <ThemeTile key={id} id={id} label={th.label} theme={th.theme} active={t.theme === id} onClick={() => set({ theme: id })} />
          ))}
        </div>
      </Group>

      <Group title="Cursor & behavior">
        <Row label="Cursor style">
          <Segmented
            value={t.cursorStyle}
            onChange={(v) => set({ cursorStyle: v as Settings["terminal"]["cursorStyle"] })}
            options={[
              { value: "block", label: "Block" },
              { value: "bar", label: "Bar" },
              { value: "underline", label: "Underline" },
            ]}
          />
        </Row>
        <Row label="Blinking cursor">
          <Toggle checked={t.cursorBlink} onChange={(v) => set({ cursorBlink: v })} />
        </Row>
        <Row label="Scrollback" hint="Lines kept in memory per terminal.">
          <Select value={String(t.scrollback)} onChange={(v) => set({ scrollback: Number(v) })}>
            {[1000, 5000, 10000, 50000, 100000].map((n) => (
              <option key={n} value={n}>
                {n.toLocaleString()} lines
              </option>
            ))}
          </Select>
        </Row>
        <Row label="Copy on select" hint="Selected text is copied to the clipboard automatically.">
          <Toggle checked={t.copyOnSelect} onChange={(v) => set({ copyOnSelect: v })} />
        </Row>
        {isMac && (
          <Row label="Use Option as Meta key" hint="Lets Option+key send Alt sequences (e.g. word jumps in bash/zsh).">
            <Toggle checked={t.optionAsMeta} onChange={(v) => set({ optionAsMeta: v })} />
          </Row>
        )}
      </Group>
    </>
  );
}

function SftpSettings() {
  const f = useSettings((s) => s.settings.sftp);
  const update = useSettings((s) => s.update);
  const set = (patch: Partial<Settings["sftp"]>) => update({ sftp: patch });
  return (
    <Group title="Files" onReset={() => useSettings.getState().reset("sftp")}>
      <Row label="Show hidden files" hint="Default for newly opened panes; each pane can still toggle it.">
        <Toggle checked={f.showHidden} onChange={(v) => set({ showHidden: v })} />
      </Row>
      <Row label="Keep folders on top">
        <Toggle checked={f.foldersFirst} onChange={(v) => set({ foldersFirst: v })} />
      </Row>
      <Row label="Confirm before deleting">
        <Toggle checked={f.confirmDelete} onChange={(v) => set({ confirmDelete: v })} />
      </Row>
      <Row label="When a file already exists" hint="Applies to copies between panes and uploads.">
        <Segmented
          value={f.onConflict}
          onChange={(v) => set({ onConflict: v as Settings["sftp"]["onConflict"] })}
          options={[
            { value: "ask", label: "Ask" },
            { value: "overwrite", label: "Replace" },
          ]}
        />
      </Row>
    </Group>
  );
}

function ConnectionSettings() {
  const c = useSettings((s) => s.settings.connection);
  const update = useSettings((s) => s.update);
  const set = (patch: Partial<Settings["connection"]>) => update({ connection: patch });
  return (
    <Group title="SSH" note="Changes apply to new connections." onReset={() => useSettings.getState().reset("connection")}>
      <Row label="Connection timeout">
        <Select value={String(c.timeoutSecs)} onChange={(v) => set({ timeoutSecs: Number(v) })}>
          {[5, 10, 15, 30, 60].map((n) => (
            <option key={n} value={n}>
              {n} seconds
            </option>
          ))}
        </Select>
      </Row>
      <Row label="Keepalive interval" hint="Sends a probe so idle sessions aren't dropped by routers.">
        <Select value={String(c.keepaliveSecs)} onChange={(v) => set({ keepaliveSecs: Number(v) })}>
          <option value={0}>Off</option>
          {[15, 30, 60, 120].map((n) => (
            <option key={n} value={n}>
              Every {n} seconds
            </option>
          ))}
        </Select>
      </Row>
      <Row label="Use SSH agent and ~/.ssh keys" hint="Tried automatically when a host has no key or its key is rejected.">
        <Toggle checked={c.useAgent} onChange={(v) => set({ useAgent: v })} />
      </Row>
    </Group>
  );
}

function ShortcutSettings() {
  const sc = useSettings((s) => s.settings.shortcuts);
  const update = useSettings((s) => s.update);
  const preset = matchingPreset(sc);
  // Bumped when all bindings are replaced at once, so rows drop their "removed from…" notes.
  const [epoch, setEpoch] = useState(0);
  const tabOptions = isMac
    ? [
        { value: "Mod", label: "⌘1 – ⌘9" },
        { value: "Ctrl", label: "⌃1 – ⌃9" },
        { value: "Alt", label: "⌥1 – ⌥9" },
      ]
    : [
        { value: "Mod", label: "Ctrl+1 – Ctrl+9" },
        { value: "Alt", label: "Alt+1 – Alt+9" },
        { value: "Ctrl+Alt", label: "Ctrl+Alt+1 – 9" },
      ];
  // Match by meaning ("Ctrl" and "Mod" are the same key off macOS); keep any other stored value selectable.
  const tabValue = tabOptions.find((o) => sc.tabNumbers && usedByTabNumbers(`${sc.tabNumbers}+1`, o.value))?.value ?? sc.tabNumbers;
  if (tabValue && !tabOptions.some((o) => o.value === tabValue)) {
    tabOptions.push({ value: tabValue, label: `${formatAccel(`${tabValue}+1`)} – 9` });
  }
  tabOptions.push({ value: "", label: "Off" });
  const groups = [...new Set(SHORTCUT_ACTIONS.map((a) => a.group))];

  return (
    <>
      <Group
        title="Keymap"
        onReset={() => {
          useSettings.getState().reset("shortcuts");
          setEpoch((n) => n + 1);
        }}
      >
        <Row label="Preset" hint="Start from the shortcuts of a client you already know, then change any of them below.">
          <Select
            value={preset ?? "custom"}
            onChange={(v) => {
              if (v === "custom") return;
              update({ shortcuts: presetShortcuts(v) });
              setEpoch((n) => n + 1);
            }}
          >
            {Object.entries(SHORTCUT_PRESETS).map(([id, p]) => (
              <option key={id} value={id}>
                {p.label}
              </option>
            ))}
            {!preset && (
              <option value="custom" disabled>
                Custom
              </option>
            )}
          </Select>
        </Row>
        <Row label="Switch to tab" hint="Tab 1 is the Vault, 2 is SFTP; 9 always goes to the last tab.">
          <Select value={tabValue} onChange={(v) => update({ shortcuts: { tabNumbers: v } })}>
            {tabOptions.map((o) => (
              <option key={o.value || "off"} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Row>
      </Group>
      {groups.map((g) => (
        <Group key={`${g}-${epoch}`} title={g}>
          {SHORTCUT_ACTIONS.filter((a) => a.group === g).map((a) => (
            <ShortcutRow key={a.id} action={a.id} label={a.label} hint={"hint" in a ? a.hint : undefined} />
          ))}
        </Group>
      ))}
    </>
  );
}

function ShortcutRow({ action, label, hint }: { action: ShortcutAction; label: string; hint?: string }) {
  const sc = useSettings((s) => s.settings.shortcuts);
  const update = useSettings((s) => s.update);
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const boxRef = useRef<HTMLButtonElement>(null);
  const value = sc.bindings[action];

  useEffect(() => {
    if (!recording) return;
    shortcutRecorder.active = true;
    const stop = () => {
      setRecording(false);
      setMessage((m) => (m?.error ? null : m));
    };
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const accel = eventAccel(e);
      if (!accel) return;
      if (accel === "Esc") return stop();
      if (accel === "Backspace" || accel === "Delete") {
        update({ shortcuts: { bindings: { [action]: "" } } });
        setMessage(null);
        return stop();
      }
      const problem = accelProblem(accel) ?? (usedByTabNumbers(accel, sc.tabNumbers) ? `${formatAccel(accel)} switches tabs (see “Switch to tab” above).` : null);
      if (problem) return setMessage({ text: problem, error: true });

      const patch: Partial<Record<ShortcutAction, string>> = { [action]: accel };
      const taken = SHORTCUT_ACTIONS.find((a) => a.id !== action && normalize(sc.bindings[a.id]) === normalize(accel));
      if (taken) patch[taken.id] = "";
      update({ shortcuts: { bindings: patch } });
      setMessage(taken ? { text: `Removed from “${taken.label}”.`, error: false } : null);
      stop();
    };
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) stop();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("blur", stop);
    return () => {
      shortcutRecorder.active = false;
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("blur", stop);
    };
  }, [recording, action, sc, update]);

  return (
    <Row label={label} hint={message ? <span className={message.error ? "text-danger" : undefined}>{message.text}</span> : hint}>
      <div className="flex items-center gap-1">
        <button
          ref={boxRef}
          onClick={() => {
            setMessage(null);
            setRecording((r) => !r);
          }}
          title={recording ? "Press the new shortcut. Esc cancels, Delete clears it." : "Click to change"}
          className={clsx(
            "flex h-8 min-w-[150px] items-center justify-center gap-1 rounded-lg px-2.5 text-[12.5px] transition-colors",
            recording ? "bg-accent/15 text-accent ring-1 ring-accent" : "bg-input hover:bg-raised",
          )}
        >
          {recording ? (
            "Type shortcut…"
          ) : value ? (
            accelParts(value).map((k, i) => (
              <kbd key={i} className="min-w-[20px] rounded-md border border-line bg-panel px-1.5 py-px text-center font-sans text-[12px] text-fg">
                {k}
              </kbd>
            ))
          ) : (
            <span className="text-faint">Not set</span>
          )}
        </button>
        <button
          title="Clear"
          disabled={!value}
          onClick={() => {
            update({ shortcuts: { bindings: { [action]: "" } } });
            setMessage(null);
          }}
          className="flex h-8 w-6 items-center justify-center rounded text-faint hover:text-fg disabled:invisible"
        >
          <X size={13} />
        </button>
      </div>
    </Row>
  );
}

function About() {
  const [info, setInfo] = useState<{ version: string; dataDir: string; platform: string; arch: string } | null>(null);
  useEffect(() => {
    invoke<{ version: string; dataDir: string; platform: string; arch: string }>("app_info").then(setInfo).catch(() => {});
  }, []);

  const resetAll = async () => {
    const ok = await confirmDialog({
      title: "Reset all settings?",
      message: "Appearance, terminal, SFTP, connection and shortcut settings go back to their defaults. Hosts and keys are not affected.",
      confirmLabel: "Reset",
      danger: true,
    });
    if (!ok) return;
    const { reset } = useSettings.getState();
    (Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]).forEach(reset);
  };

  return (
    <>
      <div className="mb-6 flex items-center gap-4">
        <img src="/knot.svg" alt="" className="h-20 w-20" draggable={false} />
        <div>
          <div className="text-[20px] font-semibold">Knot</div>
          <div className="text-[13px] text-muted">SSH & SFTP client</div>
          {info && (
            <div className="mt-1 text-xs text-faint">
              Version {info.version} · {info.platform} {info.arch}
            </div>
          )}
        </div>
      </div>
      <Group title="Data">
        <Row label="Data folder" hint={<span className="selectable font-mono">{info?.dataDir ?? "…"}</span>}>
          <Button size="sm" disabled={!info} onClick={() => info && void revealItemInDir(info.dataDir)}>
            <FolderOpen size={14} /> {isMac ? "Show in Finder" : "Show in Explorer"}
          </Button>
        </Row>
        <Row label="Passwords and passphrases" hint={isMac ? "Stored in the macOS Keychain, never in the data folder." : "Stored in the Windows Credential Manager."}>
          <span />
        </Row>
        <Row label="Reset settings" hint="Restore every setting to its default value.">
          <Button size="sm" variant="danger" onClick={resetAll}>
            Reset all
          </Button>
        </Row>
      </Group>
    </>
  );
}

// ===== previews =====

function AppearancePreview({ mode }: { mode: Appearance }) {
  const pane = (dark: boolean) => (
    <div className={clsx("flex h-full flex-1 flex-col gap-1 p-1.5", dark ? "bg-[#161821]" : "bg-[#f5f5f7]")}>
      <div className={clsx("h-1.5 w-8 rounded-full", dark ? "bg-[#2b2e3f]" : "bg-[#d5d6dd]")} />
      <div className="flex flex-1 gap-1">
        <div className={clsx("w-5 rounded", dark ? "bg-[#1f2130]" : "bg-[#ebebef]")} />
        <div className="flex flex-1 flex-col gap-1">
          <div className={clsx("h-3 rounded", dark ? "bg-[#262939]" : "bg-white")} />
          <div className={clsx("h-3 rounded", dark ? "bg-[#262939]" : "bg-white")} />
          <div className="h-1.5 w-6 rounded-full bg-accent" />
        </div>
      </div>
    </div>
  );
  return (
    <div className="flex h-[72px] overflow-hidden rounded-lg border border-line">
      {mode === "system" ? (
        <>
          {pane(false)}
          {pane(true)}
        </>
      ) : (
        pane(mode === "dark")
      )}
    </div>
  );
}

function ThemeTile({ label, theme, active, onClick }: { id: string; label: string; theme: import("@xterm/xterm").ITheme; active: boolean; onClick: () => void }) {
  const colors = [theme.red, theme.green, theme.yellow, theme.blue, theme.magenta, theme.cyan];
  return (
    <button onClick={onClick} className={clsx("rounded-xl border-2 p-1.5 text-left transition-colors", active ? "border-accent" : "border-transparent hover:border-line")}>
      <div className="flex h-[54px] flex-col justify-between rounded-lg p-2 font-mono text-[10px]" style={{ background: theme.background, color: theme.foreground }}>
        <span>
          <span style={{ color: theme.green }}>~</span> $ ls
        </span>
        <div className="flex gap-1">
          {colors.map((c, i) => (
            <span key={i} className="h-2 w-2 rounded-full" style={{ background: c }} />
          ))}
        </div>
      </div>
      <div className="mt-1.5 truncate px-0.5 text-xs">{label}</div>
    </button>
  );
}

function TerminalPreview() {
  const t = useSettings((s) => s.settings.terminal);
  const mode = useSettings((s) => s.mode);
  const th = terminalTheme(t, mode);
  const cursor =
    t.cursorStyle === "block" ? (
      <span style={{ background: th.cursor, color: th.cursorAccent }}>&nbsp;</span>
    ) : (
      <span style={{ borderLeft: t.cursorStyle === "bar" ? `2px solid ${th.cursor}` : undefined, borderBottom: t.cursorStyle === "underline" ? `2px solid ${th.cursor}` : undefined }}>
        &nbsp;
      </span>
    );
  return (
    <div
      className="mb-6 overflow-hidden rounded-xl border border-line px-4 py-3"
      style={{ background: th.background, color: th.foreground, fontFamily: terminalFontStack(t.fontFamily), fontSize: t.fontSize, lineHeight: t.lineHeight }}
    >
      <div>
        <span style={{ color: th.green }}>user@web-1</span>:<span style={{ color: th.blue }}>~/project</span>$ ls -la
      </div>
      <div>
        <span style={{ color: th.blue }}>drwxr-xr-x</span> src/ <span style={{ color: th.green }}>build.sh</span> README.md{" "}
        <span style={{ color: th.yellow }}>config.yaml</span>
      </div>
      <div>
        <span style={{ color: th.red }}>error:</span> connection refused <span style={{ color: th.magenta }}>[port 5432]</span>
      </div>
      <div>
        <span style={{ color: th.green }}>user@web-1</span>:<span style={{ color: th.blue }}>~/project</span>$ {cursor}
      </div>
    </div>
  );
}

// ===== controls =====

function Group({ title, note, onReset, children }: { title: string; note?: string; onReset?: () => void; children: ReactNode }) {
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-end justify-between px-1">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-faint">{title}</h2>
          {note && <div className="mt-0.5 text-xs text-faint">{note}</div>}
        </div>
        {onReset && (
          <button onClick={onReset} className="text-xs text-muted hover:text-fg">
            Restore defaults
          </button>
        )}
      </div>
      <div className="divide-y divide-line/70 overflow-hidden rounded-xl bg-panel">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-[52px] items-center gap-6 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-[13px]">{label}</div>
        {hint && <div className="mt-0.5 break-all text-xs text-faint">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={clsx("relative h-[22px] w-[38px] rounded-full transition-colors", checked ? "bg-accent" : "bg-raised")}
    >
      <span className={clsx("absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow transition-[left]", checked ? "left-[18px]" : "left-[2px]")} />
    </button>
  );
}

function Segmented({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="flex rounded-lg bg-input p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={clsx("h-7 rounded-md px-3 text-[12.5px]", value === o.value ? "bg-panel text-fg shadow-sm" : "text-muted hover:text-fg")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Select({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: ReactNode }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 min-w-[180px] rounded-lg bg-input px-2.5 text-[13px] text-fg outline-none focus:ring-1 focus:ring-accent/60"
    >
      {children}
    </select>
  );
}

function Stepper({ value, min, max, step, format, onChange }: { value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void }) {
  const clamp = (v: number) => Number(Math.min(max, Math.max(min, Math.round(v / step) * step)).toFixed(2));
  return (
    <div className="flex h-8 items-center rounded-lg bg-input">
      <button onClick={() => onChange(clamp(value - step))} disabled={value <= min} className="flex h-8 w-8 items-center justify-center text-muted hover:text-fg disabled:opacity-30">
        <Minus size={14} />
      </button>
      <span className="w-14 text-center text-[13px] tabular-nums">{format(value)}</span>
      <button onClick={() => onChange(clamp(value + step))} disabled={value >= max} className="flex h-8 w-8 items-center justify-center text-muted hover:text-fg disabled:opacity-30">
        <Plus size={14} />
      </button>
    </div>
  );
}
