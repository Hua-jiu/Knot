import clsx from "clsx";
import { ChevronRight, Folder, MoreHorizontal } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { useDrag, type Side } from "../lib/drag";
import type { Listing } from "../lib/types";
import { Menu } from "./ui";

export function PathBreadcrumbs({
  segments,
  side,
  onNavigate,
}: {
  segments: Listing["segments"];
  side: Side;
  onNavigate: (path: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleFrom, setVisibleFrom] = useState(0);
  const over = useDrag((s) => s.over);

  useLayoutEffect(() => {
    const container = containerRef.current!;
    const measure = measureRef.current!;
    const update = () => {
      const [menuWidth, ...widths] = Array.from(measure.children, (el) => el.getBoundingClientRect().width);
      const available = container.getBoundingClientRect().width;
      if (widths.reduce((sum, width) => sum + width, 0) <= available) {
        setVisibleFrom(0);
        return;
      }
      let start = Math.max(0, widths.length - 1);
      let used = menuWidth + (widths[start] ?? 0);
      while (start > 1 && used + widths[start - 1] <= available) {
        used += widths[--start];
      }
      setVisibleFrom(start);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    observer.observe(measure);
    return () => observer.disconnect();
  }, [segments]);

  const start = Math.min(visibleFrom, Math.max(0, segments.length - 1));
  return (
    <div
      ref={containerRef}
      aria-label="Current path"
      title={segments[segments.length - 1]?.path}
      className="relative ml-1 flex min-w-0 flex-1 items-center overflow-hidden"
    >
      {/* Measure natural widths independently of the compressed visible path. */}
      <div ref={measureRef} aria-hidden="true" className="pointer-events-none invisible absolute flex w-max items-center">
        <span className="flex h-7 shrink-0 items-center px-1.5"><MoreHorizontal size={16} /></span>
        {segments.map((segment, i) => (
          <span key={segment.path} className="flex shrink-0 items-center">
            {i > 0 && <ChevronRight size={14} className="mx-0.5 shrink-0" />}
            <span className="flex h-7 items-center gap-1.5 whitespace-nowrap px-1.5 text-[13.5px]">
              <Folder size={16} className="shrink-0" />
              {segment.name}
            </span>
          </span>
        ))}
      </div>
      {start > 0 && (
        <Menu.Root>
          <Menu.Trigger asChild>
            <button aria-label="Show parent folders" title="Show parent folders" className="flex h-7 shrink-0 items-center rounded-md px-1.5 text-muted hover:bg-hover hover:text-fg">
              <MoreHorizontal size={16} />
            </button>
          </Menu.Trigger>
          <Menu.Content>
            {segments.slice(0, start).map((segment) => (
              <Menu.Item key={segment.path} onSelect={() => onNavigate(segment.path)}>
                <Folder size={16} className="shrink-0 fill-folder text-folder" />
                <span className="max-w-[min(360px,60vw)] truncate" title={segment.path}>{segment.path}</span>
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Root>
      )}
      {segments.slice(start).map((segment, i) => {
        const last = start + i === segments.length - 1;
        const isDrop = over?.side === side && over.rowPath === `crumb:${segment.path}`;
        return (
          <div key={segment.path} className={clsx("flex min-w-0 items-center", last ? "shrink" : "shrink-0")}>
            {start + i > 0 && <ChevronRight size={14} className="mx-0.5 shrink-0 text-faint" />}
            <button
              data-drop-dir={segment.path}
              data-drop-row={`crumb:${segment.path}`}
              data-side={side}
              aria-current={last ? "page" : undefined}
              title={segment.path}
              onClick={() => !last && onNavigate(segment.path)}
              className={clsx(
                "flex h-7 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-[13.5px]",
                last ? "text-fg" : "text-muted hover:bg-hover hover:text-fg",
                isDrop && "bg-accent/30 text-fg",
              )}
            >
              <Folder size={16} className="shrink-0 fill-folder text-folder" />
              <span className="truncate">{segment.name}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
