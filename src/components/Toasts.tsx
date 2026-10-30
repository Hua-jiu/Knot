import clsx from "clsx";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useApp } from "../store";

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-[360px] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={clsx(
            "animate-in pointer-events-auto flex items-start gap-2.5 rounded-xl border bg-popover px-3.5 py-3 text-[13px] shadow-2xl",
            t.kind === "error" ? "border-danger/40" : "border-line",
          )}
        >
          {t.kind === "error" ? (
            <AlertCircle size={16} className="mt-px shrink-0 text-danger" />
          ) : t.kind === "success" ? (
            <CheckCircle2 size={16} className="mt-px shrink-0 text-emerald-400" />
          ) : (
            <Info size={16} className="mt-px shrink-0 text-accent" />
          )}
          <div className="selectable min-w-0 flex-1 break-words leading-snug">{t.message}</div>
          <button onClick={() => dismiss(t.id)} className="shrink-0 text-faint hover:text-fg">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
