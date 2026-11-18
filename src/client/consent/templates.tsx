// The template shells. Each wraps `children` (the current step: phone form, code
// form, details, success) in its layout. Placement on the page is the caller's job.
import type { ReactNode, Ref } from "react";
import type { PopupContent, PopupTemplateKey } from "@/lib/consent/templates";
import { CloseButton, cn } from "./ui";

/** float: card over the page · fill: fills the theme's /login panel · preview: dashboard gallery */
export type Frame = "float" | "fill" | "preview";

export type ShellProps = {
  templateKey: PopupTemplateKey;
  content: PopupContent;
  frame: Frame;
  onClose?: () => void;
  /** Hide the headline (consent details, coupon screen). */
  bare?: boolean;
  /** The current step (phone form, code form, details, success). */
  children: ReactNode;
  cardRef?: Ref<HTMLElement>;
};

const dialog = { role: "dialog", "aria-modal": true, "aria-labelledby": "oc-title" } as const;

function Brand({ content, className }: { content: PopupContent; className?: string }) {
  if (!content.brandName) return null;
  return (
    <span className={cn("mb-3 block text-xs font-semibold uppercase tracking-[.2em] text-neutral-500", className)}>
      {content.brandName}
    </span>
  );
}

function Heading({ content, compact, center }: { content: PopupContent; compact?: boolean; center?: boolean }) {
  return (
    <>
      <Brand content={content} className={compact ? "tracking-[.08em]" : undefined} />
      <p id="oc-title" className={cn("text-xl font-semibold leading-snug", compact && "text-lg", !center && "pr-7")}>
        {content.headline}
      </p>
      <p className="mb-4.5 mt-1.5 text-sm leading-snug text-neutral-600">{content.subheadline}</p>
    </>
  );
}

function Legal({ content, className }: { content: PopupContent; className?: string }) {
  return <p className={cn("mt-3.5 text-[11px] leading-snug text-neutral-500", className)}>{content.legal}</p>;
}

/** Merchant image, or abstract art in the brand colour. */
function Art({ content, className }: { content: PopupContent; className?: string }) {
  if (content.imageUrl) {
    return (
      <span className={cn("relative block overflow-hidden", className)}>
        <img src={content.imageUrl} alt="" className="block size-full object-cover" />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "relative block overflow-hidden bg-linear-150 from-[color-mix(in_srgb,var(--brand)_13%,transparent)] to-[color-mix(in_srgb,var(--brand)_33%,transparent)]",
        className,
      )}
    >
      <span className="absolute -left-10 top-6 size-40 rounded-full bg-(--brand) opacity-20" />
      <span className="absolute -bottom-12 -right-[20%] size-56 rounded-full bg-(--brand) opacity-15" />
      <span className="absolute left-1/3 top-1/2 size-16 rotate-12 rounded-[18px] bg-white/50" />
    </span>
  );
}

const cardBase = "relative bg-white rounded-2xl shadow-2xl ring-1 ring-black/5";
const filled = "size-full max-w-none rounded-none shadow-none ring-0";

/** Compact, split, spotlight and banner. The welcome offer has its own component (welcome.tsx). */
export function TemplateShell(props: ShellProps) {
  const { templateKey, content, frame, onClose, bare, children, cardRef } = props;
  const fill = frame === "fill";


  if (templateKey === "banner") {
    return (
      <section
        ref={cardRef}
        role="region"
        aria-labelledby="oc-title"
        className={cn(
          "relative w-full bg-white",
          frame === "preview"
            ? "rounded-2xl border border-black/10 shadow-2xl"
            : "border-t border-black/10 shadow-[0_-12px_32px_-12px_rgb(0_0_0/.18)]",
        )}
      >
        <span className="mx-auto flex max-w-[1120px] flex-col gap-3.5 py-4.5 pl-5 pr-14 md:flex-row md:items-center md:gap-8 md:py-5 md:pl-7 md:pr-16">
          <span className="block min-w-0 md:flex-1">
            <Brand content={content} className="mb-1.5 tracking-[.08em]" />
            <p id="oc-title" className="text-base font-semibold leading-snug">
              {content.headline}
            </p>
            {!bare && <p className="mt-0.5 text-[13px] leading-snug text-neutral-600">{content.subheadline}</p>}
            <Legal content={content} className="mt-2" />
          </span>
          <span className="block md:w-[400px] md:shrink-0">{children}</span>
        </span>
        <CloseButton onClose={onClose} className="top-2.5 md:top-1/2 md:-translate-y-1/2" />
      </section>
    );
  }

  if (templateKey === "compact") {
    return (
      <section ref={cardRef} {...dialog} className={cn(cardBase, "w-[360px] max-w-full p-5", fill && cn(filled, "flex flex-col justify-center p-7"))}>
        <CloseButton onClose={onClose} />
        {!bare && <Heading content={content} compact />}
        {children}
        <Legal content={content} />
      </section>
    );
  }

  if (templateKey === "split") {
    return (
      <section
        ref={cardRef}
        {...dialog}
        className={cn(cardBase, "grid w-[680px] max-w-full overflow-hidden sm:grid-cols-[1fr_1.1fr]", fill && filled)}
      >
        <Art content={content} className={cn("hidden sm:block", fill ? "h-full" : "min-h-[380px]")} />
        <span className="relative flex flex-col justify-center p-7 text-center">
          <CloseButton onClose={onClose} />
          {!bare && <Heading content={content} center />}
          {children}
          <Legal content={content} />
        </span>
      </section>
    );
  }

  // spotlight
  return (
    <section
      ref={cardRef}
      {...dialog}
      className={cn("relative w-[680px] max-w-full overflow-hidden rounded-2xl shadow-2xl", fill && "size-full max-w-none rounded-none shadow-none")}
    >
      <Art content={content} className="absolute inset-0" />
      <span className="absolute inset-0 bg-black/25" />
      <span className={cn("relative flex items-center justify-center p-6", fill ? "h-full" : "min-h-[400px]")}>
        <span className="relative block w-full max-w-[340px] rounded-2xl bg-white/90 p-6 shadow-xl backdrop-blur-md">
          <CloseButton onClose={onClose} />
          {!bare && <Heading content={content} />}
          {children}
          <Legal content={content} />
        </span>
      </span>
    </section>
  );
}
