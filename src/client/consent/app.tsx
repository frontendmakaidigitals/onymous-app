// Popup page modes (see PopupBootstrap):
//   live     opened by onymous-consent.js; talks to it with onymous:* messages
//   panel    /login inside the theme snippet's panel; GC_AUTH_STATE / GC_PANEL_CLOSE
//   silent   /login?silent=1: recognise the device, report auth state, no UI
//   preview  dashboard gallery / Customize; edits arrive via postMessage
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  DOCKED_TEMPLATES,
  HEX_RE,
  isTemplateKey,
  resolveContent,
  type PopupBootstrap,
  type PopupTemplateKey,
} from "@/lib/consent/templates";
import { notifyAuth } from "@/client/parent-bridge";
import { recognizeDevice } from "@/client/identity-client";
import {
  embeddingOrigin,
  post,
  recognizeByCookie,
  setParentOrigin,
} from "./bridge";
import { CodeStep, CouponView, PhoneStep, SignedIn } from "./steps";
import { TemplateShell, type Frame } from "./templates";
import { BrandButton, PhoneField, cn, onColor } from "./ui";
import { WelcomeFlow } from "./welcome";

// ── Placement on the page ─────────────────────────────────────────────────

type Placement = "overlay" | "dock" | "bar" | "fill" | "preview";

const PLACEMENT: Record<Placement, string> = {
  overlay: "fixed inset-0 flex items-center justify-center bg-black/40 p-4",
  dock: "fixed inset-x-3 bottom-3 flex justify-center sm:bottom-6 sm:left-auto sm:right-6",
  bar: "fixed inset-x-0 bottom-0",
  fill: "fixed inset-0 flex bg-white",
  preview:
    "pointer-events-none fixed inset-0 flex items-center justify-center p-6 [&_*]:pointer-events-none",
};

function placementFor(
  mode: PopupBootstrap["mode"],
  key: PopupTemplateKey,
): Placement {
  if (mode === "preview") return "preview";
  if (mode === "panel") return "fill";
  if (key === "compact") return "dock";
  if (key === "banner") return "bar";
  return "overlay";
}

function Stage({
  placement,
  primary,
  onBackdrop,
  children,
}: {
  placement: Placement;
  primary: string;
  onBackdrop?: () => void;
  children: ReactNode;
}) {
  const vars = {
    "--brand": primary,
    "--on-brand": onColor(primary),
  } as CSSProperties;
  return (
    <main
      style={vars}
      className={PLACEMENT[placement]}
      onClick={
        placement === "overlay" && onBackdrop
          ? (e) => e.target === e.currentTarget && onBackdrop()
          : undefined
      }
    >
      {children}
    </main>
  );
}

// ── Sign-in flow ──────────────────────────────────────────────────────────

type Step =
  | { name: "phone" }
  | { name: "code"; phone: string }
  | { name: "done"; token: string };

function SignInFlow({
  boot,
  frame,
  close,
  onCard,
}: {
  boot: PopupBootstrap;
  frame: Frame;
  /** Shopper dismissed the popup. */
  close: () => void;
  onCard?: (el: HTMLElement | null) => void;
}) {
  const { templateKey, content, shop } = boot;
  const [step, setStep] = useState<Step>({ name: "phone" });
  const [dial, setDial] = useState("+971");
  const [number, setNumber] = useState("");

  // Tell the storefront (cart sync), then let the host close us. Runs once.
  const finished = useRef(false);
  const finish = useCallback(
    async (token: string) => {
      if (finished.current) return;
      finished.current = true;
      await notifyAuth(true, token);
      if (boot.mode === "live") post({ type: "onymous:done" });
      else close();
    },
    [boot.mode, close],
  );

  const coupon = step.name === "done" && !!content.couponCode;
  useEffect(() => {
    if (step.name !== "done") return;
    const t = setTimeout(() => void finish(step.token), coupon ? 5000 : 1200);
    return () => clearTimeout(t);
  }, [step, coupon, finish]);

  // Once signed in, closing (✕ or Escape) still completes the sign-in
  const onClose = step.name === "done" ? () => void finish(step.token) : close;
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (templateKey === "welcome") {
    return (
      <WelcomeFlow
        content={content}
        shop={shop}
        frame={frame}
        signedIn={step.name === "done"}
        onClose={onClose}
        onVerified={(token) => setStep({ name: "done", token })}
      />
    );
  }

  let body: ReactNode;
  if (step.name === "phone") {
    body = (
      <PhoneStep
        templateKey={templateKey}
        content={content}
        shop={shop}
        dial={dial}
        number={number}
        onDial={setDial}
        onNumber={setNumber}
        onSent={(phone) => setStep({ name: "code", phone })}
      />
    );
  } else if (step.name === "code") {
    body = (
      <CodeStep
        shop={shop}
        phone={step.phone}
        onChangeNumber={() => setStep({ name: "phone" })}
        onVerified={(token) => setStep({ name: "done", token })}
      />
    );
  } else {
    body = coupon ? (
      <CouponView content={content} />
    ) : (
      <SignedIn banner={templateKey === "banner"} />
    );
  }

  return (
    <TemplateShell
      templateKey={templateKey}
      content={content}
      frame={frame}
      onClose={onClose}
      bare={coupon}
      cardRef={onCard}
    >
      {body}
    </TemplateShell>
  );
}

// ── Modes ─────────────────────────────────────────────────────────────────

/**
 * Docked templates (compact, banner) report their height so the host can shrink the
 * iframe to the card and keep the rest of the storefront clickable.
 */
function useReportSize(
  card: HTMLElement | null,
  templateKey: PopupTemplateKey,
  enabled: boolean,
) {
  useEffect(() => {
    if (!enabled || !card || !DOCKED_TEMPLATES.includes(templateKey)) return;
    const margin = templateKey === "compact" ? 48 : 0; // dock offset + shadow room
    const ro = new ResizeObserver(() =>
      post({
        type: "onymous:resize",
        height: Math.ceil(card.getBoundingClientRect().height) + margin,
      }),
    );
    ro.observe(card);
    return () => ro.disconnect();
  }, [card, templateKey, enabled]);
}

function Live({ boot }: { boot: PopupBootstrap }) {
  const [ready, setReady] = useState(false);
  const [card, setCard] = useState<HTMLElement | null>(null);
  const close = useCallback(() => post({ type: "onymous:close" }), []);

  useEffect(() => {
    setParentOrigin(boot.parentOrigin);
    let cancelled = false;
    // Already trusted on this device? Identify silently and never show the popup.
    // Cookie only here; fingerprinting runs at verify time (it is billed per call).
    void recognizeByCookie(boot.shop).then(async (token) => {
      if (cancelled) return;
      if (!token) return setReady(true);
      await notifyAuth(true, token);
      post({ type: "onymous:done" });
    });
    return () => {
      cancelled = true;
    };
  }, [boot]);

  useEffect(() => {
    if (ready) post({ type: "onymous:ready", template: boot.templateKey });
  }, [ready, boot.templateKey]);

  useReportSize(card, boot.templateKey, true);

  if (!ready) return null;
  return (
    <Stage
      placement={placementFor("live", boot.templateKey)}
      primary={boot.primaryColor}
      onBackdrop={close}
    >
      <SignInFlow boot={boot} frame="float" close={close} onCard={setCard} />
    </Stage>
  );
}

function Panel({ boot }: { boot: PopupBootstrap }) {
  const [show, setShow] = useState(false);
  const [card, setCard] = useState<HTMLElement | null>(null);
  const close = useCallback(() => post({ type: "GC_PANEL_CLOSE" }), []);
  // auto: placed like the dashboard preview; the snippet sizes its iframe from our messages
  const auto = boot.placement === "auto";

  useEffect(() => {
    if (show && auto)
      post({ type: "onymous:ready", template: boot.templateKey });
  }, [show, auto, boot.templateKey]);
  useReportSize(card, boot.templateKey, auto);

  useEffect(() => {
    // Only talk to the store's own storefront
    const origin = embeddingOrigin();
    if (window.parent === window || !boot.allowedParents?.includes(origin))
      return;
    setParentOrigin(origin);
    const silent = boot.mode === "silent";

    void (async () => {
      // The silent probe runs on every page view: cookie only (fingerprinting is billed per call).
      // The panel is opened by the shopper, so it may fall back to the fingerprint.
      let token: string | null = null;
      try {
        token = silent
          ? await recognizeByCookie(boot.shop)
          : boot.shop
            ? ((await recognizeDevice(boot.shop))?.token ?? null)
            : null;
      } catch {}
      await notifyAuth(!!token, token);
      if (silent) return;
      if (token) return close();
      setShow(true);
    })();
  }, [boot, close]);

  if (!show) return null;
  if (auto) {
    return (
      <Stage
        placement={placementFor("live", boot.templateKey)}
        primary={boot.primaryColor}
        onBackdrop={close}
      >
        <SignInFlow boot={boot} frame="float" close={close} onCard={setCard} />
      </Stage>
    );
  }
  return (
    <Stage placement="fill" primary={boot.primaryColor}>
      <SignInFlow boot={boot} frame="fill" close={close} />
    </Stage>
  );
}

function Preview({ boot }: { boot: PopupBootstrap }) {
  const [view, setView] = useState({
    templateKey: boot.templateKey,
    content: boot.content,
    primaryColor: boot.primaryColor,
  });

  // The dashboard pushes edits while the merchant types (Customize panel)
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!boot.previewOrigin || e.origin !== boot.previewOrigin) return;
      const d = e.data as Partial<PopupBootstrap> & { type?: string };
      if (d?.type !== "onymous:preview") return;
      setView((v) => ({
        templateKey: isTemplateKey(d.templateKey)
          ? d.templateKey
          : v.templateKey,
        content: d.content
          ? resolveContent({ ...v.content, ...d.content })
          : v.content,
        primaryColor:
          typeof d.primaryColor === "string" && HEX_RE.test(d.primaryColor)
            ? d.primaryColor
            : v.primaryColor,
      }));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [boot.previewOrigin]);

  const { templateKey, content } = view;
  if (templateKey === "welcome") {
    return (
      <Stage placement="preview" primary={view.primaryColor}>
        <WelcomeFlow
          content={content}
          shop={null}
          frame="preview"
          signedIn={false}
          onVerified={() => {}}
        />
      </Stage>
    );
  }
  return (
    <Stage placement="preview" primary={view.primaryColor}>
      <TemplateShell
        templateKey={templateKey}
        content={content}
        frame="preview"
        onClose={() => {}}
      >
        <div
          className={cn(
            "flex flex-col gap-2.5",
            templateKey === "banner" && "flex-row flex-wrap items-center",
          )}
        >
          <PhoneField
            dial="+971"
            number=""
            interactive={false}
            className={
              templateKey === "banner" ? "flex-[1_1_200px]" : undefined
            }
          />
          <BrandButton type="button" tabIndex={-1}>
            {content.buttonLabel}
          </BrandButton>
        </div>
      </TemplateShell>
    </Stage>
  );
}

export function App({ boot }: { boot: PopupBootstrap }) {
  if (boot.mode === "preview") return <Preview boot={boot} />;
  if (boot.mode === "panel" || boot.mode === "silent")
    return <Panel boot={boot} />;
  return <Live boot={boot} />;
}
