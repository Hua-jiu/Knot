import { Channel } from "@tauri-apps/api/core";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal, type ITerminalOptions } from "@xterm/xterm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AlertTriangle, ChevronDown, ChevronUp, RotateCw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, IconButton, Spinner } from "../components/ui";
import { api, toApiError, toBytes } from "../lib/api";
import { withPasswordRetry } from "../lib/connect";
import { isMac } from "../lib/format";
import { terminalFontStack, terminalTheme, useSettings, type Settings } from "../lib/settings";
import { terminalCommands } from "../lib/shortcuts";
import type { Target } from "../lib/types";
import { useApp } from "../store";


function xtermOptions(t: Settings["terminal"], mode: "light" | "dark"): ITerminalOptions {
  return {
    theme: terminalTheme(t, mode),
    fontFamily: terminalFontStack(t.fontFamily),
    fontSize: t.fontSize,
    lineHeight: t.lineHeight,
    cursorStyle: t.cursorStyle,
    cursorBlink: t.cursorBlink,
    scrollback: t.scrollback,
    macOptionIsMeta: t.optionAsMeta,
  };
}

type Status = { kind: "connecting" } | { kind: "connected" } | { kind: "error"; message: string } | { kind: "exited"; code: number | null };

export function TerminalView({
  sessionId,
  target,
  active,
  onTitle,
}: {
  sessionId: string;
  target: Target;
  /** Visible and focused: gets keyboard input. */
  active: boolean;
  /** Title set by the shell (OSC 0/2), e.g. "user@host: ~". */
  onTitle?: (title: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const sessionRef = useRef<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "connecting" });
  const [attempt, setAttempt] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const closeSession = useApp((s) => s.closeSession);
  const onTitleRef = useRef(onTitle);
  onTitleRef.current = onTitle;
  const termSettings = useSettings((s) => s.settings.terminal);
  const mode = useSettings((s) => s.mode);
  const copyOnSelect = useRef(termSettings.copyOnSelect);
  copyOnSelect.current = termSettings.copyOnSelect;

  // Create the xterm instance once per tab.
  useEffect(() => {
    const { settings, mode } = useSettings.getState();
    const term = new Terminal({
      ...xtermOptions(settings.terminal, mode),
      allowProposedApi: true,
      macOptionClickForcesSelection: true,
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";
    term.loadAddon(new WebLinksAddon((e, uri) => (e.metaKey || e.ctrlKey) && openUrl(uri)));
    term.open(hostRef.current!);
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      /* falls back to the DOM renderer */
    }

    // App shortcuts (find, clear, ...) are dispatched from a window-level handler; see lib/shortcuts.ts.
    term.attachCustomKeyEventHandler((e) => {
      // Windows/Linux: Ctrl+Shift+C / V for copy & paste (Ctrl+C stays SIGINT).
      if (!isMac && e.type === "keydown" && e.ctrlKey && e.shiftKey) {
        if (e.code === "KeyC") {
          const sel = term.getSelection();
          if (sel) void navigator.clipboard.writeText(sel);
          return false;
        }
        if (e.code === "KeyV") {
          void navigator.clipboard.readText().then((t) => term.paste(t));
          return false;
        }
      }
      return true;
    });

    term.onSelectionChange(() => {
      const sel = term.getSelection();
      if (copyOnSelect.current && sel) void navigator.clipboard.writeText(sel).catch(() => {});
    });
    term.onTitleChange((t) => onTitleRef.current?.(t));
    term.onData((d) => sessionRef.current && void api.termWrite(sessionRef.current, d).catch(() => {}));
    term.onResize(({ cols, rows }) => sessionRef.current && void api.termResize(sessionRef.current, cols, rows).catch(() => {}));

    termRef.current = term;
    fitRef.current = fit;
    searchRef.current = search;
    terminalCommands.set(sessionId, {
      find: () => setSearchOpen(true),
      clear: () => term.clear(),
      focus: () => term.focus(),
    });

    const ro = new ResizeObserver(() => {
      if (hostRef.current?.offsetParent) fit.fit();
    });
    ro.observe(hostRef.current!);
    fit.fit();

    return () => {
      terminalCommands.delete(sessionId);
      ro.disconnect();
      if (sessionRef.current) void api.termClose(sessionRef.current);
      sessionRef.current = null;
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // (Re)connect.
  useEffect(() => {
    const term = termRef.current!;
    let cancelled = false;
    setStatus({ kind: "connecting" });

    const onData = new Channel<ArrayBuffer | number[]>();
    onData.onmessage = (m) => term.write(toBytes(m));
    const onEvent = new Channel<{ type: "exit"; code: number | null }>();
    onEvent.onmessage = (ev) => {
      sessionRef.current = null;
      const what = target.kind === "local" ? "Process exited" : "Connection closed";
      term.write(`\r\n\x1b[90m[${what}${ev.code != null ? ` · exit ${ev.code}` : ""}]\x1b[0m\r\n`);
      setStatus({ kind: "exited", code: ev.code });
    };

    fitRef.current?.fit();
    withPasswordRetry(target, (t) => api.termOpen(t, term.cols, term.rows, onData, onEvent))
      .then((id) => {
        if (cancelled) {
          void api.termClose(id);
          return;
        }
        sessionRef.current = id;
        setStatus({ kind: "connected" });
        // Size may have changed while connecting.
        void api.termResize(id, term.cols, term.rows);
        term.focus();
      })
      .catch((e) => {
        if (cancelled) return;
        const err = toApiError(e);
        if (err.code === "cancelled") closeSession(sessionId);
        else setStatus({ kind: "error", message: err.message });
      });

    return () => {
      cancelled = true;
      if (sessionRef.current) {
        void api.termClose(sessionRef.current);
        sessionRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // Settings changes apply to open terminals immediately.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    Object.assign(term.options, xtermOptions(termSettings, mode));
    requestAnimationFrame(() => fitRef.current?.fit());
  }, [termSettings, mode]);

  useEffect(() => {
    if (!active) return;
    requestAnimationFrame(() => {
      fitRef.current?.fit();
      if (!searchOpen) termRef.current?.focus();
    });
  }, [active, searchOpen]);

  const reconnect = useCallback(() => {
    termRef.current?.write("\x1b[2J\x1b[H");
    setAttempt((n) => n + 1);
  }, []);

  const find = (next: boolean) => {
    const s = searchRef.current;
    if (!s || !searchText) return;
    const opts = { decorations: { matchOverviewRuler: "#f5c451", activeMatchColorOverviewRuler: "#5c8dff", activeMatchBackground: "#5c8dff80", matchBackground: "#f5c45140" } };
    if (next) s.findNext(searchText, opts);
    else s.findPrevious(searchText, opts);
  };

  return (
    <div className="relative h-full w-full" style={{ background: terminalTheme(termSettings, mode).background }}>
      <div ref={hostRef} className="h-full w-full" />

      {searchOpen && (
        <div className="animate-in absolute right-4 top-3 z-10 flex items-center gap-1 rounded-xl border border-line bg-popover p-1 shadow-xl">
          <input
            autoFocus
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") find(!e.shiftKey);
              if (e.key === "Escape") {
                setSearchOpen(false);
                searchRef.current?.clearDecorations();
              }
            }}
            placeholder="Find"
            spellCheck={false}
            className="h-7 w-48 rounded-lg bg-input px-2 text-[13px] outline-none"
          />
          <IconButton className="h-7 w-7" onClick={() => find(false)}>
            <ChevronUp size={15} />
          </IconButton>
          <IconButton className="h-7 w-7" onClick={() => find(true)}>
            <ChevronDown size={15} />
          </IconButton>
          <IconButton
            className="h-7 w-7"
            onClick={() => {
              setSearchOpen(false);
              searchRef.current?.clearDecorations();
            }}
          >
            <X size={15} />
          </IconButton>
        </div>
      )}

      {status.kind === "connecting" && (
        <Overlay>
          <Spinner className="text-accent" />
          <span className="text-muted">{target.kind === "local" ? "Starting shell…" : "Connecting…"}</span>
        </Overlay>
      )}
      {status.kind === "error" && (
        <Overlay>
          <AlertTriangle className="text-danger" size={26} />
          <div className="max-w-[460px] text-center text-[13px] text-muted">{status.message}</div>
          <div className="mt-2 flex gap-2">
            <Button onClick={() => closeSession(sessionId)}>Close</Button>
            <Button variant="primary" onClick={reconnect}>
              <RotateCw size={14} /> Retry
            </Button>
          </div>
        </Overlay>
      )}
      {status.kind === "exited" && (
        <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-line bg-popover py-1.5 pl-4 pr-1.5 shadow-xl">
          <span className="text-[13px] text-muted">Session ended</span>
          <Button size="sm" variant="primary" onClick={reconnect}>
            <RotateCw size={13} /> {target.kind === "local" ? "Restart" : "Reconnect"}
          </Button>
        </div>
      )}
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-app/95">{children}</div>;
}
