// "Welcome offer" template: a port of checkout-app's /login page (app/login/page.tsx),
// with the store's own content in place of the hard-coded Teeser copy.
// Uses the same pieces: react-international-phone, input-otp, embla carousel,
// the shadcn checkbox look and the 12-bar spinner.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import useEmblaCarousel from "embla-carousel-react";
import Autoplay from "embla-carousel-autoplay";
import { OTPInput, REGEXP_ONLY_DIGITS, type SlotProps } from "input-otp";
import {
  FlagImage,
  defaultCountries,
  getActiveFormattingMask,
  parseCountry,
  usePhoneInput,
  type ParsedCountry,
} from "react-international-phone";
import { ArrowLeft, Check, ChevronDown, ChevronUp, Copy, X } from "lucide-react";
import { isValidPhoneNumber } from "libphonenumber-js/mobile";
import { parseHighlights, type PopupContent } from "@/lib/consent/templates";
import { preloadFingerprint } from "@/client/fp-client";
import { sendCode, verifyCode } from "./bridge";
import type { Frame } from "./templates";
import { cn } from "./ui";
import { OTP_LENGTH } from "@/lib/otp-code"; // what /api/auth/otp issues

const RESEND_SECONDS = 60; // matches the server's resend cooldown

// ── Shell ─────────────────────────────────────────────────────────────────

export function WelcomeFlow({
  content,
  shop,
  frame,
  signedIn,
  onClose,
  onVerified,
}: {
  content: PopupContent;
  shop: string | null;
  frame: Frame;
  /** Verified: show the coupon (or "signed in") while the host finishes up. */
  signedIn: boolean;
  onClose?: () => void;
  onVerified: (token: string) => void;
}) {
  const preview = frame === "preview";
  return (
    <main
      role="dialog"
      aria-modal="true"
      aria-labelledby="oc-title"
      className={cn(
        "relative grid h-auto w-full grid-cols-1 grid-rows-[auto_auto] overflow-hidden bg-white round font-sans sm:grid-cols-[minmax(0,52.5fr)_minmax(0,47.5fr)] sm:grid-rows-1",
        frame === "fill" && "sm:h-dvh",
        frame === "float" && "max-w-[880px] shadow-2xl sm:h-[460px]",
        frame === "preview" && "max-w-[880px] shadow-2xl sm:h-[440px]", // dashboard frames are 500px tall
      )}
    >
      <button
        type="button"
        onClick={onClose}
        tabIndex={preview ? -1 : undefined}
        aria-label="Close"
        className="absolute right-2 top-2 z-10 flex size-6 cursor-pointer items-center justify-center rounded-full bg-white/90 text-gray-800 hover:bg-white sm:right-1 sm:top-1 sm:bg-gray-300 sm:hover:bg-gray-300 lg:size-7"
      >
        <X className="size-4 lg:size-6" />
      </button>
      <Branding content={content} />
      {signedIn ? <SignedIn content={content} /> : <Login content={content} shop={shop} preview={preview} onVerified={onVerified} />}
    </main>
  );
}

// ── Left: brand panel ─────────────────────────────────────────────────────

function Branding({ content }: { content: PopupContent }) {
  const slides = useMemo(() => parseHighlights(content.highlights), [content.highlights]);
  const autoplay = useRef(Autoplay({ delay: 4000, stopOnInteraction: false }));
  const [viewport, api] = useEmblaCarousel({ loop: true }, [autoplay.current]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!api) return;
    const onSelect = () => setActive(api.selectedScrollSnap());
    onSelect();
    api.on("select", onSelect).on("reInit", onSelect);
    return () => {
      api.off("select", onSelect).off("reInit", onSelect);
    };
  }, [api]);

  return (
    <section className="flex flex-col justify-between bg-(--brand) px-4 py-10 text-(--on-brand) sm:h-full sm:px-6 sm:py-5">
      <div className="flex flex-1 flex-col items-center justify-center gap-3 pb-3 pt-2 sm:gap-4 sm:pb-0 sm:pt-0">
        {content.imageUrl ? (
          <img src={content.imageUrl} alt={content.brandName || "logo"} className="w-28 object-contain sm:w-36" />
        ) : (
          content.brandName && <p className="text-center text-3xl font-extrabold leading-none tracking-tight sm:text-4xl">{content.brandName}</p>
        )}
        <h2 className="text-center text-lg font-bold leading-tight sm:text-xl">{content.subheadline}</h2>
      </div>

      {slides.length > 0 && (
        <div>
          <div ref={viewport} className="w-full overflow-hidden">
            <div className="flex">
              {slides.map((s, i) => (
                <div key={i} className="min-w-0 shrink-0 grow-0 basis-full" aria-hidden={i !== active}>
                  <div className="flex items-center gap-3 round border border-white/40 bg-black/30 px-3 py-2.5 backdrop-blur-xl">
                    <div className="flex-1 text-center">
                      {s.title && <p className="text-[15px] font-semibold leading-tight sm:text-[16px]">{s.title}</p>}
                      {/* body hidden on mobile to keep the card compact */}
                      {s.body && <p className="mt-0.5 hidden text-xs font-medium leading-snug opacity-95 sm:block">{s.body}</p>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {slides.length > 1 && (
            <div className="mt-2.5 flex justify-center gap-1.5">
              {slides.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`Slide ${i + 1}`}
                  onClick={() => api?.scrollTo(i)}
                  className={cn("h-2 w-2 cursor-pointer rounded-full border border-(--on-brand)", i === active ? "bg-(--on-brand)" : "bg-transparent")}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ── Right: sign-in ────────────────────────────────────────────────────────

function Login({
  content,
  shop,
  preview,
  onVerified,
}: {
  content: PopupContent;
  shop: string | null;
  preview: boolean;
  onVerified: (token: string) => void;
}) {
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [dialCode, setDialCode] = useState("971");
  const [countryName, setCountryName] = useState("UAE");
  const [dialOk, setDialOk] = useState(true);
  const [touched, setTouched] = useState(false);
  const [otp, setOtp] = useState("");
  const [agreed, setAgreed] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [showDetails, setShowDetails] = useState(false);
  const verifying = useRef(false);

  const national = phone.replace(/\D/g, "").slice(dialCode.length).replace(/^0+/, "");
  const normalized = `+${dialCode}${national}`;
  // Per-country mobile rules (length + prefixes); the code goes to WhatsApp/SMS, so landlines fail
  const phoneValid = dialOk && national.length >= 4 && isValidPhoneNumber(normalized);
  const showInvalid = touched && national.length > 0 && !phoneValid;

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function sendOtp() {
    if (!agreed || !phoneValid || loading || preview) return;
    setError("");
    setLoading(true);
    const res = await sendCode(shop, normalized);
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      if (step === "otp" && res.retryAfter) setCooldown(res.retryAfter);
      return;
    }
    setStep("otp");
    setOtp("");
    setCooldown(RESEND_SECONDS);
    preloadFingerprint(); // so verify isn't slowed down
  }

  async function verifyOtp(code: string = otp) {
    if (code.length !== OTP_LENGTH || verifying.current) return;
    verifying.current = true;
    setError("");
    setLoading(true);
    const res = await verifyCode(shop, normalized, code);
    verifying.current = false;
    setLoading(false);
    if (res.ok) onVerified(res.token);
    else setError(res.error);
  }

  if (showDetails) return <Details content={content} onBack={() => setShowDetails(false)} />;

  const submitCls =
    "mt-4 flex w-full cursor-pointer items-center justify-center round border border-gray-400 bg-(--brand) py-2 text-sm font-semibold text-(--on-brand) disabled:cursor-default disabled:opacity-50";

  return (
    <section className="flex h-full min-h-0 flex-col items-center justify-center px-3 py-6 lg:py-4">
      <h1 id="oc-title" className="max-w-2xs text-center text-lg font-bold leading-[1.3] text-navy">
        {content.headline}
      </h1>

      <div className="mt-5 w-full">
        {step === "phone" ? (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void sendOtp();
            }}
          >
            <div dir="ltr">
              <SearchablePhoneInput
                value={phone}
                disabled={preview}
                onChange={(val, dial, name) => {
                  setPhone(val);
                  setDialCode(dial);
                  setCountryName(name);
                  if (error) setError("");
                }}
                onDialValid={setDialOk}
                onBlur={() => setTouched(true)}
                error={(!!error && !phoneValid) || (dialOk && showInvalid)}
              />
            </div>
            {/* Unknown/half-typed country code: no message, Continue just stays disabled */}
            {dialOk && showInvalid && !error && (
              <p className="mt-1.5 text-xs text-red-500">Enter a valid {countryName} mobile number</p>
            )}
            <button type="submit" disabled={!agreed || !phoneValid || loading} className={submitCls}>
              {loading ? <Spinner size={24} color="currentColor" /> : content.buttonLabel}
            </button>
            {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
          </form>
        ) : (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void verifyOtp();
            }}
          >
            <p className="mb-2 text-center text-xs text-gray-600">Enter the code sent to {normalized}</p>
            <label htmlFor="otp" className="sr-only">
              Verification code
            </label>
            <OtpInput
              value={otp}
              invalid={!!error}
              onChange={(val) => {
                setOtp(val);
                if (error) setError("");
                if (val.length === OTP_LENGTH) void verifyOtp(val);
              }}
            />
            {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
            <button type="submit" disabled={otp.length !== OTP_LENGTH || loading} className={submitCls}>
              {loading ? <Spinner size={24} color="currentColor" /> : "Verify & Login"}
            </button>
            <div className="mt-3 flex justify-between text-xs text-navy">
              <button
                type="button"
                className="cursor-pointer underline"
                onClick={() => {
                  setStep("phone");
                  setError("");
                }}
              >
                Change number
              </button>
              <button
                type="button"
                className="cursor-pointer underline disabled:cursor-default disabled:no-underline disabled:opacity-50"
                disabled={cooldown > 0 || loading}
                onClick={() => void sendOtp()}
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
              </button>
            </div>
          </form>
        )}

        <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-xs leading-snug text-gray-600 lg:text-sm">
          <Checkbox checked={agreed} onChange={setAgreed} disabled={preview} />
          <span>
            {content.legal}{" "}
            <button
              type="button"
              tabIndex={preview ? -1 : undefined}
              onClick={(e) => {
                e.preventDefault();
                setShowDetails(true);
              }}
              className="cursor-pointer font-bold text-blue-700 underline"
            >
              Read details
            </button>
          </span>
        </label>
      </div>

      <PoweredBy />
    </section>
  );
}

function PoweredBy() {
  return (
    <div className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-gray-500">
      <span>Powered by</span>
      <img src="/embed/assets/onymous-logo.png" alt="Onymous" width={160} height={56} className="h-4 w-auto object-contain" />
    </div>
  );
}

function Details({ content, onBack }: { content: PopupContent; onBack: () => void }) {
  const paras = content.consentDetails
    .split(/\n\s*\n/)
    .map((t) => t.trim())
    .filter(Boolean);
  return (
    <section className="flex h-full min-h-0 flex-col overflow-y-auto px-5 py-4">
      <button type="button" onClick={onBack} className="mb-2 flex cursor-pointer items-center gap-1 self-start text-[13px] font-bold text-navy underline">
        <ArrowLeft /> Back
      </button>
      <article className="space-y-3 text-sm">
        {paras.map((t, i) => (
          <p key={i}>{t}</p>
        ))}
        {content.detailsUrl && (
          <p>
            <a href={content.detailsUrl} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">
              Privacy Policy
            </a>
          </p>
        )}
      </article>
    </section>
  );
}

// ── After sign-in ─────────────────────────────────────────────────────────

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for iframes without clipboard permission
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {}
    document.body.removeChild(ta);
    return ok;
  }
}

function SignedIn({ content }: { content: PopupContent }) {
  const [copied, setCopied] = useState(false);
  const coupon = content.couponCode;

  return (
    <section role="status" className="flex h-full min-h-0 flex-col items-center justify-center px-5 py-4 text-center lg:py-6">
      {coupon ? (
        <>
          <h1 className="text-xl leading-snug text-navy">
            Apply code <span className="font-bold">{coupon}</span>
            <br />
            {content.couponHeadline}
          </h1>

          {/* Ticket */}
          <div className="relative mt-5 w-full overflow-hidden round bg-linear-135 from-[#f0642f] to-[#e04e1c] px-5 py-5 text-white">
            <div className="absolute -left-7 -top-7 z-5 size-20 rounded-full bg-white/20" />
            <div className="absolute -bottom-7 -right-7 z-5 size-40 rounded-full bg-white/10" />

            {/* side notches */}
            <span className="absolute -left-2.5 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white" />
            <span className="absolute -right-2.5 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white" />

            <p className="text-lg font-bold">{content.couponOffer}</p>

            <button
              type="button"
              onClick={async () => {
                if (!(await copyText(coupon))) return;
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="relative z-10 mx-auto mt-3 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-white/80 px-4 py-2 text-sm font-bold"
            >
              {copied ? "Copied!" : `Code: ${coupon}`}
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </button>

            <p className="mt-3 text-xs opacity-90">{content.couponNote}</p>
          </div>
        </>
      ) : (
        <>
          <span className="grid size-12 place-items-center rounded-full bg-(--brand) text-(--on-brand)">
            <Check className="size-6" strokeWidth={3} />
          </span>
          <h1 className="mt-3 text-xl leading-snug text-navy">You&apos;re signed in</h1>
        </>
      )}

      <div className="mt-4 flex items-center gap-2 text-sm text-gray-500">
        <Spinner size={24} color="black" />
        Logging you in
      </div>
    </section>
  );
}

// ── Pieces copied from checkout-app ───────────────────────────────────────

/** components/ui/spinner.tsx */
export function Spinner({ size = 40, color = "black", speed = 1, stroke = 3 }: { size?: number; color?: string; speed?: number; stroke?: number }) {
  const lines = 12;
  return (
    <div aria-hidden style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "flex-start", height: size, width: size }}>
      {Array.from({ length: lines }).map((_, i) => {
        const index = i + 1;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              top: 0,
              left: `calc(50% - ${stroke / 2}px)`,
              display: "flex",
              alignItems: "flex-start",
              height: "100%",
              width: stroke,
              transform: `rotate(${(360 / -lines) * index}deg)`,
            }}
          >
            <div
              style={{
                height: "30%",
                width: "100%",
                borderRadius: stroke / 2,
                backgroundColor: color,
                animation: `spinner-pulse ${speed}s ease-in-out infinite`,
                animationDelay: `${(speed / -lines) * index}s`,
                transformOrigin: "center bottom",
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

/** components/ui/checkbox.tsx (radix look, native input) */
function Checkbox({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <span className="relative flex size-4 shrink-0">
      <input
        type="checkbox"
        checked={checked}
        tabIndex={disabled ? -1 : undefined}
        onChange={(e) => !disabled && onChange(e.target.checked)}
        className="peer size-4 cursor-pointer appearance-none rounded-[5px] border border-transparent bg-input/90 outline-none transition-shadow checked:border-primary checked:bg-primary focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
      />
      <Check className="pointer-events-none absolute inset-0 m-auto hidden size-3.5 text-primary-foreground peer-checked:block" />
    </span>
  );
}

/** components/ui/input-otp.tsx slot */
function Slot({ char, hasFakeCaret, isActive, invalid }: SlotProps & { invalid: boolean }) {
  return (
    <div
      data-active={isActive}
      aria-invalid={invalid || undefined}
      className="relative flex aspect-6/4 w-full items-center justify-center border-y border-r border-input bg-background text-base outline-none transition-all first:round-l first:border-l last:round-r aria-invalid:border-destructive aria-invalid:bg-destructive/10 aria-invalid:text-destructive data-[active=true]:z-10 data-[active=true]:border-ring data-[active=true]:ring-3 data-[active=true]:ring-ring/30 data-[active=true]:aria-invalid:ring-destructive/20"
    >
      {char}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-4 w-px animate-caret-blink bg-neutral-900" />
        </div>
      )}
    </div>
  );
}

/** app/ui/contact-step.tsx OtpInput */
function OtpInput({ value, onChange, invalid }: { value: string; onChange: (v: string) => void; invalid: boolean }) {
  return (
    <div className="w-full">
      <OTPInput
        id="otp"
        autoFocus
        pattern={REGEXP_ONLY_DIGITS}
        maxLength={OTP_LENGTH}
        value={value}
        onChange={onChange}
        containerClassName="has-disabled:opacity-50"
        render={({ slots }) => (
          // 4 boxes at full width look oversized; keep them a fixed size, centred
          <div className="mx-auto flex max-w-64 items-center">
            {slots.map((slot, i) => (
              <Slot key={i} {...slot} invalid={invalid} />
            ))}
          </div>
        )}
      />
    </div>
  );
}

/** app/ui/searchablePhoneInput.tsx, with the dial code shown before a visible placeholder. */
const GCC = ["ae", "sa", "kw", "qa", "bh", "om"];
const sortedCountries = [
  ...defaultCountries.filter((c) => GCC.includes(parseCountry(c).iso2)),
  ...defaultCountries.filter((c) => !GCC.includes(parseCountry(c).iso2)),
];

/** Countries by dial code; shared codes (+1, +7…) list the main country first (lowest priority). */
const DIAL_INDEX = new Map<string, typeof sortedCountries>();
for (const c of sortedCountries) {
  const { dialCode } = parseCountry(c);
  DIAL_INDEX.set(dialCode, [...(DIAL_INDEX.get(dialCode) ?? []), c]);
}
for (const list of DIAL_INDEX.values())
  list.sort((a, b) => (parseCountry(a).priority ?? 0) - (parseCountry(b).priority ?? 0));

/** Country for a typed dial code: keep the current one if it shares the code (e.g. Canada on +1). */
function countryForDial(dial: string, current: string): string | null {
  const list = DIAL_INDEX.get(dial);
  if (!list) return null;
  const isos = list.map((c) => parseCountry(c).iso2);
  return isos.includes(current) ? current : isos[0]!;
}

/** Example number in the country's format, e.g. "50 123 4567" for the UAE. */
function examplePlaceholder(country: ParsedCountry) {
  if (country.iso2 === "ae") return "50 123 4567";
  const mask = getActiveFormattingMask({ phone: "", country });
  if (/^\.+$/.test(mask)) return "Phone number";
  let n = 0;
  return mask.replace(/\./g, () => "1234567890"[n++ % 10]!);
}


/** Country list height limits (px) and gap to the field / card edge. */
const LIST_MAX = 200;
const MIN_LIST = 140;
const GAP = 6;

/** Visible area for an element: its nearest clipping ancestor, within the viewport. */
function clipBox(el: HTMLElement) {
  let top = 0;
  let bottom = window.innerHeight;
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p);
    if (/(hidden|auto|scroll|clip)/.test(o.overflowY + o.overflow)) {
      const r = p.getBoundingClientRect();
      top = Math.max(top, r.top);
      bottom = Math.min(bottom, r.bottom);
    }
  }
  return { top, bottom };
}

function SearchablePhoneInput({
  value,
  onChange,
  onDialValid,
  onBlur,
  error,
  disabled,
}: {
  value: string;
  onChange: (phone: string, dialCode: string, countryName: string) => void;
  /** false while the typed dial code matches no country */
  onDialValid?: (ok: boolean) => void;
  onBlur?: () => void;
  error?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const { inputValue, country, setCountry, handlePhoneValueChange, inputRef } = usePhoneInput({
    defaultCountry: "ae",
    value,
    countries: sortedCountries,
    // Input holds only the national number, so the placeholder stays visible;
    // `phone` is still reported in full (+971…)
    disableDialCodeAndPrefix: true,
    onChange: (data) => onChange(data.phone, data.country.dialCode, data.country.name),
  });

  // Editable dial code: typing "+91" picks India without opening the list.
  // Dial codes are prefix-free, so a code is complete as soon as it matches a country.
  const [dial, setDial] = useState(country.dialCode);
  const dialRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Country picked from the list (or guessed from a pasted number): show its code
    if (document.activeElement !== dialRef.current) setDial(country.dialCode);
  }, [country.dialCode]);

  function onDialChange(raw: string, typed: boolean) {
    const digits = raw.replace(/\D/g, "").slice(0, 3); // country codes are at most 3 digits
    setDial(digits);
    const iso2 = countryForDial(digits, country.iso2);
    onDialValid?.(!!iso2);
    if (!iso2) return;
    if (iso2 !== country.iso2) {
      // setCountry clears the number; put the digits typed so far back under the new code
      const national = inputValue.replace(/\D/g, "");
      setCountry(iso2);
      const name = parseCountry(DIAL_INDEX.get(digits)!.find((c) => parseCountry(c).iso2 === iso2)!).name;
      if (national) queueMicrotask(() => onChange(`+${digits}${national}`, digits, name));
    }
    // Code complete after typing a digit: carry on into the number (not while deleting)
    if (typed) inputRef.current?.focus();
  }

  // The popup card clips its content (and the iframe ends at the card), so fit the list into
  // whatever room the card has: below the field if it fits, otherwise above, capped to the space.
  const [drop, setDrop] = useState<{ up: boolean; max: number }>({ up: false, max: LIST_MAX });
  useLayoutEffect(() => {
    if (!open || !containerRef.current) return;
    const field = containerRef.current.getBoundingClientRect();
    const box = clipBox(containerRef.current);
    const below = box.bottom - field.bottom - GAP;
    const above = field.top - box.top - GAP;
    const up = below < Math.min(LIST_MAX, MIN_LIST) && above > below;
    setDrop({ up, max: Math.max(MIN_LIST / 2, Math.min(LIST_MAX, up ? above : below)) });
  }, [open]);

  // close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedCountries;
    return sortedCountries.filter((c) => {
      const { name, iso2, dialCode } = parseCountry(c);
      return name.toLowerCase().includes(q) || iso2.includes(q) || dialCode.includes(q);
    });
  }, [search]);

  const pick = useCallback(
    (iso2: string) => {
      setCountry(iso2, { focusOnInput: true });
      setOpen(false);
      setSearch("");
    },
    [setCountry],
  );

  const field = "round border bg-white";
  return (
    <div className="relative w-full" ref={containerRef}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={`Country: ${country.name}`}
          aria-expanded={open}
          tabIndex={disabled ? -1 : undefined}
          onClick={() => !disabled && setOpen((o) => !o)}
          className={cn("flex shrink-0 cursor-pointer items-center gap-1.5 px-3 py-2 hover:bg-gray-100", field, error && "border-red-400 bg-red-50")}
        >
          <FlagImage iso2={country.iso2} className="size-5 rounded-sm" style={{ width: 20, height: 20 } as CSSProperties} />
          {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>

        <div
          className={cn(
            "flex min-w-0 flex-1 items-center focus-within:ring-2 focus-within:ring-primary/40",
            field,
            error && "border-red-400 bg-red-50",
          )}
        >
          <label className="flex items-center pl-4 text-base text-gray-900">
            <span aria-hidden="true">+</span>
            <input
              ref={dialRef}
              type="tel"
              inputMode="numeric"
              autoComplete="tel-country-code"
              aria-label="Country code"
              tabIndex={disabled ? -1 : undefined}
              readOnly={disabled}
              value={dial}
              onChange={(e) =>
                onDialChange(e.target.value, (e.nativeEvent as InputEvent).inputType?.startsWith("insert") ?? false)
              }
              onFocus={(e) => e.currentTarget.select()}
              onBlur={() => {
                // Left on an unknown/empty code: go back to the selected country's code
                if (!countryForDial(dial, country.iso2)) {
                  setDial(country.dialCode);
                  onDialValid?.(true);
                }
              }}
              onKeyDown={(e) => {
                // Arrow right at the end of the code moves into the number
                if (e.key === "ArrowRight" && e.currentTarget.selectionStart === dial.length) inputRef.current?.focus();
              }}
              // Fixed width (room for 3 digits) so typing doesn't shift the number
              className="w-[3.2ch] shrink-0 bg-transparent p-0 tabular-nums outline-none"
            />
          </label>
          <input
            ref={inputRef}
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            aria-label="Phone number"
            tabIndex={disabled ? -1 : undefined}
            readOnly={disabled}
            value={inputValue}
            onChange={handlePhoneValueChange}
            onBlur={onBlur}
            onKeyDown={(e) => {
              // Backspace / arrow left at the start of the number moves back into the code
              const el = e.currentTarget;
              if ((e.key === "Backspace" || e.key === "ArrowLeft") && el.selectionStart === 0 && el.selectionEnd === 0) {
                e.preventDefault();
                dialRef.current?.focus();
                const len = dialRef.current?.value.length ?? 0;
                dialRef.current?.setSelectionRange(len, len);
              }
            }}
            placeholder={examplePlaceholder(country)}
            className="min-w-0 flex-1 bg-transparent py-2 pl-1.5 pr-3 text-base outline-none placeholder:text-gray-400"
          />
        </div>
      </div>

      {open && (
        <div
          className={cn(
            "absolute z-50 flex w-full flex-col overflow-hidden round border bg-white shadow-2xl",
            drop.up ? "bottom-full mb-1" : "top-full mt-1",
          )}
          style={{ maxHeight: drop.max }}
        >
          <div className="sticky top-0 border-b bg-white p-1.5">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation(); // close the list, not the popup
                  setOpen(false);
                }
                if (e.key === "Enter" && filtered[0]) {
                  e.preventDefault();
                  pick(parseCountry(filtered[0]).iso2);
                }
              }}
              placeholder="Search country or code..."
              className="w-full round border px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div className="min-h-0 overflow-y-auto overscroll-contain">
            {filtered.length === 0 && <div className="p-3 text-sm text-gray-400">No countries found</div>}
            {filtered.map((c) => {
              const { iso2, name, dialCode } = parseCountry(c);
              return (
                <button
                  key={iso2}
                  type="button"
                  onClick={() => pick(iso2)}
                  className={cn("flex w-full cursor-pointer items-center gap-3 px-3 py-1.5 text-left text-sm hover:bg-gray-50", iso2 === country.iso2 && "bg-gray-100")}
                >
                  <FlagImage iso2={iso2} className="size-5" />
                  <span className="flex-1">{name}</span>
                  <span className="text-gray-400">+{dialCode}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
