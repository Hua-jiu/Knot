import { passwordDialog } from "../components/Dialogs";
import { hostById, useApp } from "../store";
import { api, toApiError } from "./api";
import type { Target } from "./types";

export function targetLabel(t: Target): string {
  if (t.kind === "local") return "Local";
  if (t.kind === "adhoc") return `${t.username}@${t.hostname}`;
  const h = hostById(t.hostId);
  return h ? h.label : "host";
}

/**
 * Run `attempt` and, on an authentication failure, ask for a password and retry.
 * For saved hosts the password can be stored in the Keychain once it works.
 */
export async function withPasswordRetry<T>(target: Target, attempt: (t: Target) => Promise<T>): Promise<T> {
  let t = target;
  let save = false;
  for (;;) {
    try {
      const result = await attempt(t);
      if (save && t.kind === "saved" && t.password) {
        const h = hostById(t.hostId);
        if (h) {
          await api.hostSave({ ...h, password: t.password });
          await useApp.getState().refreshHosts();
        }
      }
      return result;
    } catch (e) {
      const err = toApiError(e);
      if (err.code !== "auth_failed" || t.kind === "local") throw err;
      const h = t.kind === "saved" ? hostById(t.hostId) : undefined;
      const who = t.kind === "adhoc" ? `${t.username}@${t.hostname}` : h ? `${h.username}@${h.hostname}` : "the server";
      const res = await passwordDialog({
        title: `Sign in to ${targetLabel(t)}`,
        message: t.password ? "Authentication failed. Try again." : `Enter the password for ${who}.`,
        allowSave: t.kind === "saved",
      });
      if (!res) throw { code: "cancelled", message: "Cancelled" };
      t = { ...t, password: res.password };
      save = res.save;
    }
  }
}
