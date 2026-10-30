import * as Popover from "@radix-ui/react-popover";
import clsx from "clsx";
import { Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { naturalCompare, parseSshTarget } from "../lib/format";
import type { Host } from "../lib/types";
import { useApp } from "../store";
import { OsIcon } from "./OsIcon";

export type PickResult =
  | { kind: "local" }
  | { kind: "host"; host: Host }
  | { kind: "adhoc"; username: string; hostname: string; port: number };

/** Searchable popover listing saved hosts (and optionally "Local"); also accepts `user@host`. */
export function HostPicker({
  children,
  onPick,
  includeLocal,
  open,
  onOpenChange,
  onCloseAutoFocus,
  align = "start",
}: {
  children: ReactNode;
  onPick: (r: PickResult) => void;
  includeLocal?: boolean;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  onCloseAutoFocus?: (e: Event) => void;
  align?: "start" | "center" | "end";
}) {
  const hosts = useApp((s) => s.hosts);
  const [q, setQ] = useState("");
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const setOpen = (o: boolean) => {
    if (!o) setQ("");
    onOpenChange ? onOpenChange(o) : setInternalOpen(o);
  };

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return hosts
      .filter((h) => !s || h.label.toLowerCase().includes(s) || h.hostname.toLowerCase().includes(s) || h.username.toLowerCase().includes(s))
      .sort((a, b) => naturalCompare(a.label, b.label));
  }, [hosts, q]);
  const adhoc = parseSshTarget(q);

  const pick = (r: PickResult) => {
    setOpen(false);
    onPick(r);
  };

  return (
    <Popover.Root open={isOpen} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align={align}
          sideOffset={8}
          onCloseAutoFocus={onCloseAutoFocus}
          className="animate-in z-50 w-[320px] rounded-xl border border-line bg-popover p-1.5 shadow-2xl outline-none"
        >
          <div className="mb-1 flex items-center gap-2 rounded-lg bg-input px-2.5">
            <Search size={14} className="text-faint" />
            <input
              autoFocus
              spellCheck={false}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                if (adhoc) pick({ kind: "adhoc", ...adhoc });
                else if (filtered[0]) pick({ kind: "host", host: filtered[0] });
              }}
              placeholder="Search hosts or user@host"
              className="h-8 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
            />
          </div>
          <div className="max-h-[340px] overflow-y-auto">
            {includeLocal && !q && (
              <Row onClick={() => pick({ kind: "local" })}>
                <OsIcon os="local" size={28} />
                <span>Local</span>
              </Row>
            )}
            {adhoc && (
              <Row onClick={() => pick({ kind: "adhoc", ...adhoc })}>
                <OsIcon os={null} size={28} />
                <span>
                  Connect to <span className="text-fg">{`${adhoc.username}@${adhoc.hostname}`}</span>
                  {adhoc.port !== 22 && `:${adhoc.port}`}
                </span>
              </Row>
            )}
            {filtered.map((h) => (
              <Row key={h.id} onClick={() => pick({ kind: "host", host: h })}>
                <OsIcon os={h.os} size={28} />
                <div className="min-w-0">
                  <div className="truncate">{h.label}</div>
                  <div className="truncate text-[11px] text-muted">
                    {h.username ? `${h.username}@` : ""}
                    {h.hostname}
                  </div>
                </div>
              </Row>
            ))}
            {!filtered.length && !adhoc && <div className="px-3 py-6 text-center text-xs text-faint">No hosts</div>}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Row({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={clsx("flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-hover")}
    >
      {children}
    </button>
  );
}
