import clsx from "clsx";
import { KeyRound, Server, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { useApp } from "../store";
import { HostsPage } from "./HostsPage";
import { KeychainPage } from "./KeychainPage";
import { SettingsPage } from "./SettingsPage";

export function VaultView() {
  const section = useApp((s) => s.section);
  const setSection = useApp((s) => s.setSection);
  const hostCount = useApp((s) => s.hosts.length);
  const keyCount = useApp((s) => s.keys.length);

  return (
    <div className="flex h-full min-h-0">
      <nav className="flex w-[228px] shrink-0 flex-col gap-1 border-r border-line/70 bg-chrome p-3">
        <NavItem icon={<Server size={17} />} label="Hosts" count={hostCount} active={section === "hosts"} onClick={() => setSection("hosts")} />
        <NavItem
          icon={<KeyRound size={17} />}
          label="Keychain"
          count={keyCount}
          active={section === "keychain"}
          onClick={() => setSection("keychain")}
        />
        <div className="flex-1" />
        <NavItem icon={<Settings size={17} />} label="Settings" count={0} active={section === "settings"} onClick={() => setSection("settings")} />
      </nav>
      <main className="min-w-0 flex-1">
        {section === "hosts" ? <HostsPage /> : section === "keychain" ? <KeychainPage /> : <SettingsPage />}
      </main>
    </div>
  );
}

function NavItem({ icon, label, count, active, onClick }: { icon: ReactNode; label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "flex h-10 items-center gap-3 rounded-xl px-3 text-[14px] font-medium transition-colors",
        active ? "bg-raised text-fg" : "text-muted hover:bg-hover/60 hover:text-fg",
      )}
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      {count > 0 && <span className="text-xs text-faint">{count}</span>}
    </button>
  );
}
