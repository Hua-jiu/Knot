import { isMac } from "./format";

/*
 * Accelerators are strings like "Shift+Mod+T". `Mod` is ⌘ on macOS and Ctrl elsewhere;
 * `Ctrl` is the physical Control key (folded into `Mod` off macOS). Keys are named by
 * physical position (KeyboardEvent.code), so Option/AltGr layouts still match.
 */

export const SHORTCUT_ACTIONS = [
  { id: "openHosts", group: "Tabs", label: "Open host picker", hint: "Search saved hosts and connect in a new tab." },
  { id: "localTerminal", group: "Tabs", label: "New local terminal" },
  { id: "closeTab", group: "Tabs", label: "Close terminal", hint: "Closes the focused pane (or the tab) and disconnects it." },
  { id: "nextTab", group: "Tabs", label: "Next tab" },
  { id: "prevTab", group: "Tabs", label: "Previous tab" },
  { id: "find", group: "Terminal", label: "Find in terminal" },
  { id: "clearTerminal", group: "Terminal", label: "Clear terminal", hint: "Clears the scrollback; the shell is not affected." },
  { id: "fontIncrease", group: "Terminal", label: "Increase font size" },
  { id: "fontDecrease", group: "Terminal", label: "Decrease font size" },
  { id: "fontReset", group: "Terminal", label: "Reset font size" },
  { id: "openSettings", group: "App", label: "Open settings" },
] as const;

export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number]["id"];
export type Bindings = Record<ShortcutAction, string>;

interface Preset {
  label: string;
  tabNumbers: string;
  bindings: Bindings;
}

// Shared by most presets: app-level commands on the platform modifier.
const COMMON = {
  find: isMac ? "Mod+F" : "Shift+Mod+F",
  clearTerminal: isMac ? "Mod+K" : "Shift+Mod+K",
  fontIncrease: "Mod+=",
  fontDecrease: "Mod+-",
  fontReset: "Mod+0",
  openSettings: "Mod+,",
};

export const SHORTCUT_PRESETS: Record<string, Preset> = {
  knot: {
    label: "Knot",
    tabNumbers: isMac ? "Mod" : "Alt",
    bindings: {
      ...COMMON,
      openHosts: isMac ? "Mod+T" : "Shift+Mod+T",
      localTerminal: isMac ? "Mod+N" : "Shift+Mod+N",
      closeTab: isMac ? "Mod+W" : "Shift+Mod+W",
      nextTab: isMac ? "Shift+Mod+]" : "Ctrl+Tab",
      prevTab: isMac ? "Shift+Mod+[" : "Shift+Ctrl+Tab",
    },
  },
  iterm: {
    // ⌘T opens a local shell, ⌘O the profile list.
    label: "iTerm2 / Terminal",
    tabNumbers: isMac ? "Mod" : "Alt",
    bindings: {
      ...COMMON,
      openHosts: isMac ? "Mod+O" : "Shift+Mod+O",
      localTerminal: isMac ? "Mod+T" : "Shift+Mod+T",
      closeTab: isMac ? "Mod+W" : "Shift+Mod+W",
      nextTab: isMac ? "Shift+Mod+]" : "Ctrl+Tab",
      prevTab: isMac ? "Shift+Mod+[" : "Shift+Ctrl+Tab",
    },
  },
  xshell: {
    // Alt+O opens the Sessions dialog, Shift+Alt+N a new (local shell) tab.
    label: "Xshell",
    tabNumbers: "Alt",
    bindings: {
      ...COMMON,
      openHosts: "Alt+O",
      localTerminal: "Shift+Alt+N",
      closeTab: "Shift+Ctrl+F4",
      nextTab: "Ctrl+Tab",
      prevTab: "Shift+Ctrl+Tab",
    },
  },
  windowsTerminal: {
    // Ctrl+Shift+Space opens the new-tab profile menu.
    label: "Windows Terminal",
    tabNumbers: "Ctrl+Alt",
    bindings: {
      ...COMMON,
      find: "Shift+Mod+F",
      clearTerminal: "",
      openHosts: "Shift+Mod+Space",
      localTerminal: "Shift+Mod+T",
      closeTab: "Shift+Mod+W",
      nextTab: "Ctrl+Tab",
      prevTab: "Shift+Ctrl+Tab",
    },
  },
};

export function presetShortcuts(id: string): { tabNumbers: string; bindings: Bindings } {
  const p = SHORTCUT_PRESETS[id] ?? SHORTCUT_PRESETS.knot;
  return { tabNumbers: p.tabNumbers, bindings: { ...p.bindings } };
}

/** The preset the current shortcuts match exactly, or null when customized. */
export function matchingPreset(s: { tabNumbers: string; bindings: Bindings }): string | null {
  const same = (a: string, b: string) => normalize(a) === normalize(b);
  return (
    Object.keys(SHORTCUT_PRESETS).find((id) => {
      const p = SHORTCUT_PRESETS[id];
      return same(`${p.tabNumbers}+1`, `${s.tabNumbers}+1`) && SHORTCUT_ACTIONS.every((a) => same(p.bindings[a.id], s.bindings[a.id]));
    }) ?? null
  );
}

// ----- parsing & formatting -----

const MOD_ORDER = ["Ctrl", "Alt", "Shift", "Mod", "Meta"] as const;

const CODE_KEYS: Record<string, string> = {
  BracketLeft: "[", BracketRight: "]", Equal: "=", Minus: "-", Comma: ",", Period: ".", Slash: "/",
  Semicolon: ";", Quote: "'", Backquote: "`", Backslash: "\\", NumpadAdd: "=", NumpadSubtract: "-",
  Tab: "Tab", Space: "Space", Enter: "Enter", NumpadEnter: "Enter", Backspace: "Backspace", Delete: "Delete",
  Escape: "Esc", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
  ArrowLeft: "Left", ArrowRight: "Right", ArrowUp: "Up", ArrowDown: "Down",
};

function keyFromCode(code: string): string | null {
  const m = /^(?:Key([A-Z])|Digit(\d)|Numpad(\d)|(F\d{1,2}))$/.exec(code);
  if (m) return m[1] ?? m[2] ?? m[3] ?? m[4];
  return CODE_KEYS[code] ?? null;
}

/** Canonical form: modifiers in a fixed order, folded for the current platform. */
export function normalize(accel: string): string {
  if (!accel) return "";
  const parts = accel.split("+");
  // "+" itself is never a key here ("=" is used), so the last part is always the key.
  const key = parts.pop()!;
  const mods = new Set<string>();
  for (const p of parts) {
    if (p === "Ctrl" && !isMac) mods.add("Mod");
    else if (p === "Meta" && isMac) mods.add("Mod");
    else mods.add(p);
  }
  return [...MOD_ORDER.filter((m) => mods.has(m)), key].join("+");
}

/** The accelerator a key event represents, or null for a lone modifier press. */
export function eventAccel(e: KeyboardEvent): string | null {
  const key = keyFromCode(e.code);
  if (!key) return null;
  const mods: string[] = [];
  if (isMac ? e.ctrlKey : false) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (isMac ? e.metaKey : e.ctrlKey) mods.push("Mod");
  if (!isMac && e.metaKey) mods.push("Meta");
  return [...mods, key].join("+");
}

const MAC_SYMBOLS: Record<string, string> = { Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Mod: "⌘" };
const MAC_KEYS: Record<string, string> = { Tab: "⇥", Enter: "↩", Backspace: "⌫", Delete: "⌦", Esc: "⎋", Left: "←", Right: "→", Up: "↑", Down: "↓" };
const OTHER_NAMES: Record<string, string> = { Mod: "Ctrl", Meta: "Win" };

/** Split into display chips: ["⌘", "⇧", "T"] on macOS, ["Ctrl", "Shift", "T"] elsewhere. */
export function accelParts(accel: string): string[] {
  const parts = normalize(accel).split("+").filter(Boolean);
  if (!parts.length) return [];
  const key = parts.pop()!;
  if (isMac) return [...parts.map((p) => MAC_SYMBOLS[p] ?? p), MAC_KEYS[key] ?? key];
  const order = ["Mod", "Alt", "Shift", "Meta"];
  return [...order.filter((m) => parts.includes(m)).map((m) => OTHER_NAMES[m] ?? m), key];
}

export function formatAccel(accel: string): string {
  return accelParts(accel).join(isMac ? "" : "+");
}

const MAC_RESERVED = ["Mod+Q", "Mod+H", "Alt+Mod+H", "Mod+M", "Mod+C", "Mod+V", "Mod+X", "Mod+A", "Mod+Z", "Shift+Mod+Z", "Ctrl+Mod+F", "Mod+Tab", "Mod+Space"];
const OTHER_RESERVED = ["Alt+F4", "Alt+Tab", "Alt+Space"];
// Copy & paste in the terminal off macOS (Ctrl+C stays SIGINT).
const OTHER_CLIPBOARD = ["Shift+Mod+C", "Shift+Mod+V"];

/** Why an accelerator can't be used as a shortcut, or null if it can. */
export function accelProblem(accel: string): string | null {
  const a = normalize(accel);
  const parts = a.split("+");
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  if (!mods.some((m) => m !== "Shift") && !/^F\d+$/.test(key)) return `Add ${isMac ? "⌘, ⌃ or ⌥" : "Ctrl or Alt"} so the keys still type in the terminal.`;
  if ((isMac ? MAC_RESERVED : OTHER_RESERVED).includes(a)) return `${formatAccel(a)} is reserved by the system.`;
  if (!isMac && OTHER_CLIPBOARD.includes(a)) return `${formatAccel(a)} copies / pastes in the terminal.`;
  const ctrlAlone = mods.length === 1 && mods[0] === (isMac ? "Ctrl" : "Mod");
  if (ctrlAlone && /^[A-Z[\]\\]$/.test(key)) return `${formatAccel(a)} sends a control character to the terminal (e.g. Ctrl+C interrupts).`;
  return null;
}

/** Whether `accel` collides with the "switch to tab 1–9" modifier. */
export function usedByTabNumbers(accel: string, tabNumbers: string): boolean {
  if (!tabNumbers) return false;
  const a = normalize(accel);
  return /\+[1-9]$/.test(a) && normalize(`${tabNumbers}+1`).slice(0, -1) === a.slice(0, -1);
}
