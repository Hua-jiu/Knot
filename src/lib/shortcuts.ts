import { useEffect } from "react";
import { useApp } from "../store";
import { eventAccel, normalize, SHORTCUT_ACTIONS, usedByTabNumbers, type ShortcutAction } from "./keymap";
import { DEFAULT_SETTINGS, useSettings } from "./settings";

/** Commands each terminal tab registers so shortcuts can reach the active one. */
export const terminalCommands = new Map<string, { find(): void; clear(): void; focus(): void }>();

/** Set while the settings page is recording a shortcut, so keys aren't dispatched. */
export const shortcutRecorder = { active: false };

const FONT_MIN = 9;
const FONT_MAX = 28;

/** Returns false when the action doesn't apply right now, letting the key through. */
function run(action: ShortcutAction, repeat: boolean): boolean {
  const app = useApp.getState();
  const settings = useSettings.getState();
  const active = app.tabs.find((t) => t.id === app.activeTab);
  const term = active?.kind === "terminal" ? terminalCommands.get(active.focus) : undefined;
  const fontSize = settings.settings.terminal.fontSize;
  // Only font size steps make sense when a key is held down.
  if (repeat && action !== "fontIncrease" && action !== "fontDecrease") return true;

  switch (action) {
    case "openHosts":
      app.setPickerOpen(true);
      return true;
    case "localTerminal":
      app.openTerminal({ kind: "local" }, "Local");
      return true;
    case "closeTab":
      // In a workspace this closes the focused pane; the tab goes with its last one.
      if (active?.kind !== "terminal") return false;
      app.closeSession(active.focus);
      return true;
    case "nextTab":
    case "prevTab": {
      const i = app.tabs.findIndex((t) => t.id === app.activeTab);
      const n = app.tabs.length;
      app.setActive(app.tabs[(i + (action === "nextTab" ? 1 : n - 1)) % n].id);
      return true;
    }
    case "find":
      term?.find();
      return !!term;
    case "clearTerminal":
      term?.clear();
      return !!term;
    case "fontIncrease":
      settings.update({ terminal: { fontSize: Math.min(FONT_MAX, fontSize + 1) } });
      return true;
    case "fontDecrease":
      settings.update({ terminal: { fontSize: Math.max(FONT_MIN, fontSize - 1) } });
      return true;
    case "fontReset":
      settings.update({ terminal: { fontSize: DEFAULT_SETTINGS.terminal.fontSize } });
      return true;
    case "openSettings":
      app.setSection("settings");
      app.setActive("vault");
      return true;
  }
}

/** Installs the window-level key handler. Runs in the capture phase, ahead of xterm. */
export function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shortcutRecorder.active || e.isComposing) return;
      const accel = eventAccel(e);
      if (!accel) return;
      const { bindings, tabNumbers } = useSettings.getState().settings.shortcuts;

      const action = SHORTCUT_ACTIONS.find((a) => bindings[a.id] && normalize(bindings[a.id]) === accel)?.id;
      if (action) {
        if (run(action, e.repeat)) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      if (usedByTabNumbers(accel, tabNumbers)) {
        const { tabs, setActive } = useApp.getState();
        const n = Number(accel.slice(-1));
        // Like browsers, 9 always means the last tab.
        const tab = n === 9 ? tabs[tabs.length - 1] : tabs[n - 1];
        if (tab) setActive(tab.id);
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}
