// Small building blocks shared by the templates and steps.
// Brand colour comes from CSS variables set on the root: --brand and --on-brand.
import { useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { X } from "lucide-react";

export const cn = (...c: ClassValue[]) => twMerge(clsx(c));

/** Black or white, whichever reads better on the brand colour. */
export function onColor(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const lum = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    })
    .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i]!, 0);
  return lum > 0.45 ? "#111111" : "#ffffff";
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-5 animate-spin rounded-full border-[2.5px] border-current border-r-transparent motion-reduce:[animation-duration:2s]",
        className,
      )}
    />
  );
}

export function CloseButton({ onClose, className }: { onClose?: () => void; className?: string }) {
  return (
    <button
      type="button"
      aria-label="Close"
      tabIndex={onClose ? undefined : -1}
      onClick={onClose}
      className={cn(
        "absolute right-3 top-3 z-10 grid size-8 cursor-pointer place-items-center rounded-full text-neutral-500 hover:bg-black/5",
        className,
      )}
    >
      <X className="size-4" strokeWidth={2.4} />
    </button>
  );
}

/** Primary action in the brand colour. Shows a spinner instead of the label while busy. */
export function BrandButton({
  busy,
  busyLabel = "Please wait",
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; busyLabel?: string }) {
  return (
    <button
      type="submit"
      {...props}
      disabled={props.disabled || busy}
      className={cn(
        "flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-(--brand) px-5 text-sm font-semibold text-(--on-brand) transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-50",
        className,
      )}
    >
      {busy ? (
        <>
          <Spinner />
          <span className="sr-only">{busyLabel}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

export function ErrorText({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <p role="alert" className={cn("text-xs text-red-600 empty:hidden", className)}>
      {children}
    </p>
  );
}

// ── Phone field ───────────────────────────────────────────────────────────

const DIAL_CODES = ["+971", "+966", "+965", "+974", "+968", "+973", "+91"];

export function PhoneField({
  dial,
  number,
  onDial,
  onNumber,
  interactive = true,
  autoFocus,
  className,
}: {
  dial: string;
  number: string;
  onDial?: (dial: string) => void;
  onNumber?: (number: string) => void;
  interactive?: boolean;
  autoFocus?: boolean;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const tab = interactive ? undefined : -1;
  return (
    <span className={cn("flex h-11 overflow-hidden rounded-xl border border-black/15 bg-white focus-within:border-black/45", className)}>
      <select
        aria-label="Country code"
        tabIndex={tab}
        value={dial}
        onChange={(e) => {
          onDial?.(e.target.value);
          input.current?.focus();
        }}
        className="border-r border-black/10 bg-transparent px-2 text-sm text-neutral-800 outline-none"
      >
        {DIAL_CODES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <input
        ref={input}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        placeholder="50 123 4567"
        aria-label="Phone number"
        tabIndex={tab}
        autoFocus={autoFocus}
        value={number}
        readOnly={!onNumber}
        onChange={(e) => onNumber?.(e.target.value)}
        className="min-w-0 flex-1 bg-transparent px-3 text-[15px] outline-none placeholder:text-neutral-400"
      />
    </span>
  );
}
