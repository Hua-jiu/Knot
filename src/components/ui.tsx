import * as Dialog from "@radix-ui/react-dialog";
import * as DM from "@radix-ui/react-dropdown-menu";
import * as CM from "@radix-ui/react-context-menu";
import clsx from "clsx";
import { X } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-white hover:bg-accent-hover disabled:bg-accent/40 disabled:text-white/60",
  secondary: "bg-raised text-fg hover:bg-hover disabled:text-faint",
  ghost: "text-fg hover:bg-hover disabled:text-faint",
  danger: "bg-danger/15 text-danger hover:bg-danger/25",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }
>(({ variant = "secondary", size = "md", className, ...rest }, ref) => (
  <button
    ref={ref}
    className={clsx(
      "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed",
      size === "md" ? "h-9 px-3.5 text-[13px]" : "h-7 px-2.5 text-xs",
      variants[variant],
      className,
    )}
    {...rest}
  />
));

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }>(
  ({ className, active, ...rest }, ref) => (
    <button
      ref={ref}
      className={clsx(
        "inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-40",
        active && "bg-hover text-fg",
        className,
      )}
      {...rest}
    />
  ),
);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...rest }, ref) => (
  <input
    ref={ref}
    spellCheck={false}
    autoCorrect="off"
    autoCapitalize="off"
    className={clsx(
      "h-9 w-full rounded-lg border border-transparent bg-input px-3 text-[13px] text-fg placeholder:text-faint",
      "outline-none focus:border-accent/60",
      className,
    )}
    {...rest}
  />
));

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-faint">{hint}</span>}
    </label>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={clsx("inline-block h-4 w-4 rounded-full border-2 border-current border-t-transparent", className)}
      style={{ animation: "knot-spin 0.7s linear infinite" }}
    />
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 440,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <Dialog.Content
          className="animate-in fixed left-1/2 top-1/2 z-50 max-h-[85vh] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-2xl border border-line bg-panel p-5 shadow-2xl outline-none"
          style={{ width }}
          aria-describedby={undefined}
        >
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-[15px] font-semibold">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton aria-label="Close">
                <X size={16} />
              </IconButton>
            </Dialog.Close>
          </div>
          {children}
          {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const menuContent =
  "animate-in z-50 min-w-[190px] rounded-xl border border-line bg-popover p-1 text-[13px] shadow-2xl outline-none";
const menuItem =
  "flex h-8 cursor-default select-none items-center gap-2 rounded-lg px-2.5 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-white data-[disabled]:text-faint";

export const Menu = {
  Root: DM.Root,
  Trigger: DM.Trigger,
  Content: ({ children, align = "start" }: { children: ReactNode; align?: "start" | "end" }) => (
    <DM.Portal>
      <DM.Content className={menuContent} sideOffset={6} align={align}>
        {children}
      </DM.Content>
    </DM.Portal>
  ),
  Item: ({ children, onSelect, danger, disabled }: MenuItemProps) => (
    <DM.Item className={clsx(menuItem, danger && "text-danger")} onSelect={onSelect} disabled={disabled}>
      {children}
    </DM.Item>
  ),
  Separator: () => <DM.Separator className="my-1 h-px bg-line" />,
};

export const Context = {
  Root: CM.Root,
  Trigger: CM.Trigger,
  Content: ({ children }: { children: ReactNode }) => (
    <CM.Portal>
      <CM.Content className={menuContent}>{children}</CM.Content>
    </CM.Portal>
  ),
  Item: ({ children, onSelect, danger, disabled }: MenuItemProps) => (
    <CM.Item className={clsx(menuItem, danger && "text-danger")} onSelect={onSelect} disabled={disabled}>
      {children}
    </CM.Item>
  ),
  Separator: () => <CM.Separator className="my-1 h-px bg-line" />,
};

interface MenuItemProps {
  children: ReactNode;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
}
