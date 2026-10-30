import { SquareTerminal } from "lucide-react";
import { useApp, type Session } from "../store";
import { OsIcon } from "./OsIcon";

/** Icon for a terminal session: Local, the saved host's distro, or a generic terminal. */
export function SessionIcon({ session, size = 16 }: { session: Session | undefined; size?: number }) {
  const os = useApp((s) => (session?.hostId ? s.hosts.find((h) => h.id === session.hostId)?.os : undefined));
  if (session?.target.kind === "local") return <OsIcon os="local" size={size} />;
  if (session?.hostId) return <OsIcon os={os} size={size} />;
  return <SquareTerminal size={size} className="shrink-0" />;
}
