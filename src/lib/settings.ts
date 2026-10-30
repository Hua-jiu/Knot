import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ITheme } from "@xterm/xterm";
import { create } from "zustand";
import { presetShortcuts, type Bindings } from "./keymap";

export type Appearance = "system" | "light" | "dark";

const IS_MAC = navigator.userAgent.includes("Mac");
export type CursorStyle = "block" | "bar" | "underline";

export interface Settings {
  general: {
    appearance: Appearance;
    accent: AccentId;
    uiFont: string;
    /** Webview zoom factor. */
    uiScale: number;
  };
  terminal: {
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
    /** "auto" follows the app appearance. */
    theme: string;
    cursorStyle: CursorStyle;
    cursorBlink: boolean;
    scrollback: number;
    copyOnSelect: boolean;
    optionAsMeta: boolean;
  };
  sftp: {
    showHidden: boolean;
    foldersFirst: boolean;
    confirmDelete: boolean;
    onConflict: "ask" | "overwrite";
  };
  connection: {
    timeoutSecs: number;
    keepaliveSecs: number;
    useAgent: boolean;
  };
  shortcuts: {
    /** Modifier for "switch to tab 1–9" (e.g. "Mod", "Alt"); "" turns it off. */
    tabNumbers: string;
    /** Accelerator per action; "" means unassigned. */
    bindings: Bindings;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  general: { appearance: "dark", accent: "blue", uiFont: "system", uiScale: 1 },
  terminal: {
    fontFamily: IS_MAC ? "SF Mono" : "Cascadia Mono",
    fontSize: 13,
    lineHeight: 1.2,
    theme: "auto",
    cursorStyle: "block",
    cursorBlink: true,
    scrollback: 10000,
    copyOnSelect: false,
    optionAsMeta: true,
  },
  sftp: { showHidden: false, foldersFirst: true, confirmDelete: true, onConflict: "ask" },
  connection: { timeoutSecs: 15, keepaliveSecs: 30, useAgent: true },
  shortcuts: presetShortcuts("knot"),
};

// ----- presets -----

export const ACCENTS = {
  blue: "#2f6bff",
  violet: "#7c5cff",
  teal: "#14a3a3",
  green: "#22a06b",
  orange: "#f08a24",
  pink: "#e5487f",
  graphite: "#6b7280",
} as const;
export type AccentId = keyof typeof ACCENTS;

const SYSTEM_UI = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

export const UI_FONTS: { id: string; label: string; css: string }[] = [
  { id: "system", label: "System", css: SYSTEM_UI },
  { id: "PingFang SC", label: "PingFang SC", css: `"PingFang SC", ${SYSTEM_UI}` },
  { id: "Helvetica Neue", label: "Helvetica Neue", css: `"Helvetica Neue", ${SYSTEM_UI}` },
  { id: "Avenir Next", label: "Avenir Next", css: `"Avenir Next", ${SYSTEM_UI}` },
  { id: "Inter", label: "Inter", css: `"Inter", ${SYSTEM_UI}` },
  { id: "Segoe UI", label: "Segoe UI", css: `"Segoe UI", ${SYSTEM_UI}` },
];

export const TERMINAL_FONTS = [
  ...(IS_MAC ? ["SF Mono"] : []),
  "Menlo",
  "Monaco",
  "JetBrains Mono",
  "Fira Code",
  "Cascadia Code",
  "Cascadia Mono",
  "Source Code Pro",
  "Hack",
  "Consolas",
];

// SF Mono ships inside Terminal.app rather than as a system font; WebKit exposes it as `ui-monospace`.
const FAMILY_ALIASES: Record<string, string> = { "SF Mono": "ui-monospace" };

export function terminalFontStack(family: string): string {
  const head = FAMILY_ALIASES[family] ? `${FAMILY_ALIASES[family]}, "${family}"` : `"${family}"`;
  return `${head}, ui-monospace, Menlo, "Cascadia Mono", Consolas, "PingFang SC", monospace`;
}

/** Whether a locally installed font is available to the webview. */
export function fontInstalled(family: string): boolean {
  if (FAMILY_ALIASES[family]) return IS_MAC;
  try {
    return document.fonts.check(`12px "${family}"`) && fontDiffersFromFallback(family);
  } catch {
    return true;
  }
}

// document.fonts.check() returns true for unknown families; compare glyph widths against a fallback.
const widthCache = new Map<string, boolean>();
function fontDiffersFromFallback(family: string): boolean {
  if (widthCache.has(family)) return widthCache.get(family)!;
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return true;
  const sample = "mmmmmmmmmmlli10OO@#";
  const result = ["monospace", "serif", "sans-serif"].some((fb) => {
    ctx.font = `20px ${fb}`;
    const base = ctx.measureText(sample).width;
    ctx.font = `20px "${family}", ${fb}`;
    return ctx.measureText(sample).width !== base;
  });
  widthCache.set(family, result);
  return result;
}

const KNOT_DARK: ITheme = {
  background: "#161821",
  foreground: "#d8dae3",
  cursor: "#7aa2ff",
  cursorAccent: "#161821",
  selectionBackground: "#3a4a7a80",
  black: "#262938",
  red: "#f0525f",
  green: "#3fcf8e",
  yellow: "#f5c451",
  blue: "#5c8dff",
  magenta: "#c678dd",
  cyan: "#43c6d8",
  white: "#d8dae3",
  brightBlack: "#5f6378",
  brightRed: "#ff6b77",
  brightGreen: "#5ee0a5",
  brightYellow: "#ffd772",
  brightBlue: "#7aa2ff",
  brightMagenta: "#d69bf0",
  brightCyan: "#6fdcea",
  brightWhite: "#ffffff",
};

const KNOT_LIGHT: ITheme = {
  background: "#ffffff",
  foreground: "#24292f",
  cursor: "#2f6bff",
  cursorAccent: "#ffffff",
  selectionBackground: "#2f6bff33",
  black: "#24292f",
  red: "#cf222e",
  green: "#1a7f37",
  yellow: "#9a6700",
  blue: "#0969da",
  magenta: "#8250df",
  cyan: "#1b7c83",
  white: "#6e7781",
  brightBlack: "#57606a",
  brightRed: "#a40e26",
  brightGreen: "#2da44e",
  brightYellow: "#bf8700",
  brightBlue: "#218bff",
  brightMagenta: "#a475f9",
  brightCyan: "#3192aa",
  brightWhite: "#8c959f",
};

export const TERMINAL_THEMES: Record<string, { label: string; theme: ITheme }> = {
  "knot-dark": { label: "Knot Dark", theme: KNOT_DARK },
  "knot-light": { label: "Knot Light", theme: KNOT_LIGHT },
  dracula: {
    label: "Dracula",
    theme: {
      background: "#282a36", foreground: "#f8f8f2", cursor: "#f8f8f2", selectionBackground: "#44475a",
      black: "#21222c", red: "#ff5555", green: "#50fa7b", yellow: "#f1fa8c", blue: "#bd93f9", magenta: "#ff79c6", cyan: "#8be9fd", white: "#f8f8f2",
      brightBlack: "#6272a4", brightRed: "#ff6e6e", brightGreen: "#69ff94", brightYellow: "#ffffa5", brightBlue: "#d6acff", brightMagenta: "#ff92df", brightCyan: "#a4ffff", brightWhite: "#ffffff",
    },
  },
  nord: {
    label: "Nord",
    theme: {
      background: "#2e3440", foreground: "#d8dee9", cursor: "#d8dee9", selectionBackground: "#434c5e",
      black: "#3b4252", red: "#bf616a", green: "#a3be8c", yellow: "#ebcb8b", blue: "#81a1c1", magenta: "#b48ead", cyan: "#88c0d0", white: "#e5e9f0",
      brightBlack: "#4c566a", brightRed: "#bf616a", brightGreen: "#a3be8c", brightYellow: "#ebcb8b", brightBlue: "#81a1c1", brightMagenta: "#b48ead", brightCyan: "#8fbcbb", brightWhite: "#eceff4",
    },
  },
  "one-dark": {
    label: "One Dark",
    theme: {
      background: "#282c34", foreground: "#abb2bf", cursor: "#528bff", selectionBackground: "#3e4451",
      black: "#282c34", red: "#e06c75", green: "#98c379", yellow: "#e5c07b", blue: "#61afef", magenta: "#c678dd", cyan: "#56b6c2", white: "#abb2bf",
      brightBlack: "#5c6370", brightRed: "#e06c75", brightGreen: "#98c379", brightYellow: "#e5c07b", brightBlue: "#61afef", brightMagenta: "#c678dd", brightCyan: "#56b6c2", brightWhite: "#ffffff",
    },
  },
  "solarized-dark": {
    label: "Solarized Dark",
    theme: {
      background: "#002b36", foreground: "#839496", cursor: "#93a1a1", selectionBackground: "#073642",
      black: "#073642", red: "#dc322f", green: "#859900", yellow: "#b58900", blue: "#268bd2", magenta: "#d33682", cyan: "#2aa198", white: "#eee8d5",
      brightBlack: "#586e75", brightRed: "#cb4b16", brightGreen: "#586e75", brightYellow: "#657b83", brightBlue: "#839496", brightMagenta: "#6c71c4", brightCyan: "#93a1a1", brightWhite: "#fdf6e3",
    },
  },
  "solarized-light": {
    label: "Solarized Light",
    theme: {
      background: "#fdf6e3", foreground: "#657b83", cursor: "#586e75", selectionBackground: "#eee8d5",
      black: "#073642", red: "#dc322f", green: "#859900", yellow: "#b58900", blue: "#268bd2", magenta: "#d33682", cyan: "#2aa198", white: "#eee8d5",
      brightBlack: "#002b36", brightRed: "#cb4b16", brightGreen: "#586e75", brightYellow: "#657b83", brightBlue: "#839496", brightMagenta: "#6c71c4", brightCyan: "#93a1a1", brightWhite: "#fdf6e3",
    },
  },
};

// ----- store -----

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** Overlay stored values on defaults, ignoring unknown keys and wrong types. */
function merge<T extends object>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== "object") return base;
  const out = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(base)) {
    const p = (patch as Record<string, unknown>)[k];
    if (p === undefined) continue;
    if (v && typeof v === "object") out[k] = merge(v as object, p);
    else if (typeof p === typeof v) out[k] = p;
  }
  return out as T;
}

const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

interface SettingsStore {
  settings: Settings;
  loaded: boolean;
  /** Resolved light/dark, after following the system when `appearance` is "system". */
  mode: "light" | "dark";
  load(): Promise<void>;
  update(patch: DeepPartial<Settings>): void;
  reset(section: keyof Settings): void;
}

let saveTimer: number | undefined;
function persist(s: Settings) {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void invoke("settings_set", { value: s }).catch(() => {}), 250);
}

function resolveMode(a: Appearance): "light" | "dark" {
  return a === "system" ? (systemDark.matches ? "dark" : "light") : a;
}

export const useSettings = create<SettingsStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  mode: "dark",
  load: async () => {
    let stored: unknown = {};
    try {
      stored = await invoke("settings_get");
    } catch {
      /* fall back to defaults */
    }
    const settings = merge(DEFAULT_SETTINGS, stored);
    set({ settings, loaded: true, mode: resolveMode(settings.general.appearance) });
  },
  update: (patch) => {
    const settings = merge(get().settings, patch);
    set({ settings, mode: resolveMode(settings.general.appearance) });
    persist(settings);
  },
  reset: (section) => {
    const settings = { ...get().settings, [section]: DEFAULT_SETTINGS[section] };
    set({ settings, mode: resolveMode(settings.general.appearance) });
    persist(settings);
  },
}));

systemDark.addEventListener("change", () => {
  const { settings } = useSettings.getState();
  if (settings.general.appearance === "system") useSettings.setState({ mode: resolveMode("system") });
});

export function terminalTheme(s: Settings["terminal"], mode: "light" | "dark"): ITheme {
  if (s.theme !== "auto" && TERMINAL_THEMES[s.theme]) return TERMINAL_THEMES[s.theme].theme;
  return mode === "dark" ? KNOT_DARK : KNOT_LIGHT;
}

/** Push appearance settings into CSS variables and the native window. */
export function applyAppearance(s: Settings, mode: "light" | "dark") {
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.style.colorScheme = mode;
  root.style.setProperty("--color-accent", ACCENTS[s.general.accent] ?? ACCENTS.blue);
  root.style.setProperty("--font-sans", (UI_FONTS.find((f) => f.id === s.general.uiFont) ?? UI_FONTS[0]).css);
  // Native title bar / traffic lights / system dialogs follow the chosen appearance.
  void getCurrentWindow()
    .setTheme(s.general.appearance === "system" ? null : s.general.appearance)
    .catch(() => {});
  void getCurrentWindow()
    .setBackgroundColor(mode === "dark" ? "#161821" : "#f5f5f7")
    .catch(() => {});
  void getCurrentWebview()
    .setZoom(s.general.uiScale)
    .catch(() => {});
}
