import clsx from "clsx";
import { Laptop, Server } from "lucide-react";

const LETTER: Record<string, { bg: string; text: string }> = {
  centos: { bg: "#262577", text: "C" },
  rhel: { bg: "#cc0000", text: "R" },
  fedora: { bg: "#3c6eb4", text: "f" },
  rocky: { bg: "#10b981", text: "R" },
  almalinux: { bg: "#0f4266", text: "A" },
  arch: { bg: "#1793d1", text: "A" },
  alpine: { bg: "#0d597f", text: "A" },
  opensuse: { bg: "#73ba25", text: "S" },
  "opensuse-leap": { bg: "#73ba25", text: "S" },
  amzn: { bg: "#ff9900", text: "a" },
  freebsd: { bg: "#ab2b28", text: "B" },
  darwin: { bg: "#3a3d4a", text: "" },
  raspbian: { bg: "#c51a4a", text: "π" },
  kali: { bg: "#367bf0", text: "K" },
};

/** Square host tile, colored by detected distro (falls back to a generic server). `os="local"` is this machine. */
export function OsIcon({ os, size = 40 }: { os: string | null | undefined; size?: number }) {
  const r = Math.round(size * 0.22);
  const base = "flex shrink-0 items-center justify-center text-white";
  const style = { width: size, height: size, borderRadius: r };

  if (os === "ubuntu") {
    return (
      <div className={base} style={{ ...style, background: "#e95420" }}>
        <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} fill="none">
          <circle cx="12" cy="12" r="6.2" stroke="white" strokeWidth="2.1" />
          <circle cx="5.2" cy="12" r="2.3" fill="white" stroke="#e95420" strokeWidth="1.2" />
          <circle cx="15.4" cy="6.1" r="2.3" fill="white" stroke="#e95420" strokeWidth="1.2" />
          <circle cx="15.4" cy="17.9" r="2.3" fill="white" stroke="#e95420" strokeWidth="1.2" />
        </svg>
      </div>
    );
  }
  if (os === "debian") {
    return (
      <div className={base} style={{ ...style, background: "#d70a53" }}>
        <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} fill="none">
          <path
            d="M13.6 17.6c-3.3.4-6.1-1.9-6.3-5.1-.2-3 2-5.6 5-5.9 2.6-.2 4.8 1.6 5.1 4.1.2 2.1-1.3 3.9-3.3 4.1-1.6.1-2.9-1-3-2.5-.1-1.2.8-2.2 1.9-2.3"
            stroke="white"
            strokeWidth="1.9"
            strokeLinecap="round"
          />
        </svg>
      </div>
    );
  }
  if (os === "local") {
    return (
      <div className={base} style={{ ...style, background: "#2f6bff" }}>
        <Laptop size={size * 0.5} strokeWidth={2.2} />
      </div>
    );
  }
  const letter = os ? LETTER[os] : undefined;
  if (letter && letter.text) {
    return (
      <div className={clsx(base, "font-semibold")} style={{ ...style, background: letter.bg, fontSize: size * 0.45 }}>
        {letter.text}
      </div>
    );
  }
  return (
    <div className={base} style={{ ...style, background: letter?.bg ?? "#14365f" }}>
      <Server size={size * 0.5} strokeWidth={2.2} />
    </div>
  );
}
