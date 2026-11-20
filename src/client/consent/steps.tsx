// Sign-in steps for the compact, split, spotlight and banner templates.
// (The welcome offer has its own flow in welcome.tsx.)
import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import type { PopupContent, PopupTemplateKey } from "@/lib/consent/templates";
import { preloadFingerprint } from "@/client/fp-client";
import { sendCode, verifyCode } from "./bridge";
import { BrandButton, ErrorText, PhoneField, Spinner, cn } from "./ui";

export { OTP_LENGTH as CODE_LENGTH } from "@/lib/otp-code";
import { OTP_LENGTH as CODE_LENGTH } from "@/lib/otp-code";

const digitsOf = (n: string) => n.replace(/\D/g, "").replace(/^0+/, "");
const validNumber = (n: string) => {
  const len = digitsOf(n).length;
  return len >= 7 && len <= 12;
};

// ── Phone ─────────────────────────────────────────────────────────────────

export function PhoneStep({
  templateKey,
  content,
  shop,
  dial,
  number,
  onDial,
  onNumber,
  onSent,
}: {
  templateKey: PopupTemplateKey;
  content: PopupContent;
  shop: string | null;
  dial: string;
  number: string;
  onDial: (v: string) => void;
  onNumber: (v: string) => void;
  onSent: (phone: string) => void;
}) {
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const banner = templateKey === "banner";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!validNumber(number)) return setError("Enter a valid phone number.");
    const phone = `${dial}${digitsOf(number)}`;
    setSending(true);
    setError("");
    const res = await sendCode(shop, phone);
    setSending(false);
    if (res.ok) onSent(phone);
    else setError(res.error);
  }

  return (
    <form noValidate onSubmit={submit} className={cn("flex flex-col gap-2.5 text-left", banner && "flex-row flex-wrap items-center")}>
      <PhoneField
        dial={dial}
        number={number}
        onDial={onDial}
        onNumber={(v) => {
          onNumber(v);
          setError("");
        }}
        autoFocus
        className={banner ? "flex-[1_1_200px]" : undefined}
      />
      <BrandButton busy={sending} busyLabel="Sending code" className={cn(banner && "shrink-0 px-5.5")}>
        {content.buttonLabel}
      </BrandButton>
      <ErrorText className={cn(banner && "basis-full")}>{error}</ErrorText>
    </form>
  );
}

// ── Code ──────────────────────────────────────────────────────────────────

export function CodeStep({
  shop,
  phone,
  onChangeNumber,
  onVerified,
}: {
  shop: string | null;
  phone: string;
  onChangeNumber: () => void;
  onVerified: (token: string) => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [wait, setWait] = useState(60);
  const busy = useRef(false);

  useEffect(() => {
    preloadFingerprint(); // so verify isn't slowed down
  }, []);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function verify(value: string) {
    if (value.length !== CODE_LENGTH) return setError(`Enter the ${CODE_LENGTH}-digit code.`);
    if (busy.current) return;
    busy.current = true;
    setVerifying(true);
    setError("");
    const res = await verifyCode(shop, phone, value);
    busy.current = false;
    if (res.ok) return onVerified(res.token);
    setVerifying(false);
    setError(res.error);
  }

  async function resend() {
    setWait(60);
    const res = await sendCode(shop, phone);
    setError(res.ok ? "" : "Couldn't resend yet. Try again in a minute.");
    if (!res.ok && res.retryAfter) setWait(res.retryAfter);
  }

  const linkCls =
    "cursor-pointer text-[13px] text-neutral-700 underline disabled:cursor-default disabled:text-neutral-400 disabled:no-underline";

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void verify(code);
      }}
      className="flex flex-col gap-2.5 text-left"
    >
      <span className="flex items-center justify-between gap-2 text-[13px] text-neutral-600">
        <span>Code sent to {phone}</span>
        <button type="button" onClick={onChangeNumber} className={linkCls}>
          Change number
        </button>
      </span>
      <span className="flex h-11 overflow-hidden rounded-xl border border-black/15 bg-white focus-within:border-black/45">
        <input
          autoFocus
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={CODE_LENGTH}
          placeholder="••••••"
          aria-label={`${CODE_LENGTH}-digit code`}
          aria-invalid={!!error || undefined}
          value={code}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH);
            setCode(v);
            setError("");
            if (v.length === CODE_LENGTH) void verify(v);
          }}
          className="min-w-0 flex-1 bg-transparent px-3 text-center text-[15px] tracking-[.5em] tabular-nums outline-none"
        />
      </span>
      <ErrorText>{error}</ErrorText>
      <BrandButton busy={verifying} busyLabel="Verifying">
        Verify
      </BrandButton>
      <span className="flex justify-end">
        <button type="button" onClick={resend} disabled={wait > 0} className={linkCls}>
          {wait > 0 ? `Resend in ${wait}s` : "Resend code"}
        </button>
      </span>
    </form>
  );
}

// ── After sign-in ─────────────────────────────────────────────────────────

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Iframes often lack clipboard permission
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {}
    ta.remove();
    return ok;
  }
}

export function CouponView({ content }: { content: PopupContent }) {
  const [copied, setCopied] = useState(false);
  const code = content.couponCode;
  return (
    <div role="status" className="flex flex-col items-center gap-4.5 text-center">
      <p className="text-xl leading-snug text-navy">
        Apply code <strong className="font-bold">{code}</strong>
        <br />
        {content.couponHeadline}
      </p>
      <div className="relative flex w-full flex-col items-center gap-3 overflow-hidden rounded-2xl bg-linear-135 from-[#f0642f] to-[#e04e1c] px-5 py-5.5 text-white">
        <span className="pointer-events-none absolute -left-7 -top-7 size-20 rounded-full bg-white/20" />
        <span className="pointer-events-none absolute -bottom-7 -right-7 size-40 rounded-full bg-white/10" />
        <span className="absolute -left-2.5 top-1/2 size-5 -translate-y-1/2 rounded-full bg-white" />
        <span className="absolute -right-2.5 top-1/2 size-5 -translate-y-1/2 rounded-full bg-white" />
        <p className="relative text-lg font-bold">{content.couponOffer}</p>
        <button
          type="button"
          onClick={async () => {
            if (!(await copyText(code))) return;
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="relative flex cursor-pointer items-center gap-2 rounded-lg border-[1.5px] border-dashed border-white/85 px-4 py-2 text-sm font-bold hover:bg-white/10"
        >
          {copied ? "Copied!" : `Code: ${code}`}
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </button>
        <p className="relative text-xs opacity-90">{content.couponNote}</p>
      </div>
      <p className="flex items-center gap-2 text-sm text-gray-500">
        <Spinner className="size-4.5 text-gray-900" />
        Logging you in
      </p>
    </div>
  );
}

export function SignedIn({ banner }: { banner?: boolean }) {
  return (
    <p role="status" className={cn("flex flex-col items-center gap-2 py-3 text-center text-[15px] font-semibold", banner && "flex-row py-1")}>
      <span className={cn("grid size-11 place-items-center rounded-full bg-(--brand) text-(--on-brand)", banner && "size-8")}>
        <Check className={banner ? "size-4" : "size-5.5"} strokeWidth={3} />
      </span>
      You&apos;re signed in
    </p>
  );
}
