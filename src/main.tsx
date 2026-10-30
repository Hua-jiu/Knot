import { createRoot } from "react-dom/client";
import App from "./App";
import { applyAppearance, useSettings } from "./lib/settings";
import "./index.css";

// Load settings before the first paint so the theme doesn't flash.
void useSettings
  .getState()
  .load()
  .then(() => {
    const { settings, mode } = useSettings.getState();
    applyAppearance(settings, mode);
    // No StrictMode: its double-mounted effects would open every SSH session twice in dev.
    createRoot(document.getElementById("root")!).render(<App />);
  });
