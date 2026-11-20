// Consent popup templates: registry + copy defaults.
// Shared by the server (config endpoint, embed pages) and the browser bundle
// (src/client/consent), so it must stay dependency-free.
//
// The dashboard keeps a copy of POPUP_TEMPLATES (keys + names) for its gallery;
// keep the keys in sync when adding a template.

export const POPUP_TEMPLATES = [
  { key: "compact", name: "Compact" },
  { key: "split", name: "Split banner" },
  { key: "spotlight", name: "Spotlight" },
  { key: "banner", name: "Consent banner" },
  { key: "welcome", name: "Welcome offer" },
] as const;

/** Templates docked to the page edge (no backdrop); the loader sizes the iframe to fit them. */
export const DOCKED_TEMPLATES: readonly PopupTemplateKey[] = ["compact", "banner"];

export type PopupTemplateKey = (typeof POPUP_TEMPLATES)[number]["key"];

export const isTemplateKey = (v: unknown): v is PopupTemplateKey =>
  POPUP_TEMPLATES.some((t) => t.key === v);

/**
 * Templates merchants can pick right now. The others still render (their code is kept)
 * but are hidden; add a key back here (in both onymous-app and the dashboard) to offer it again.
 */
export const AVAILABLE_TEMPLATES: readonly PopupTemplateKey[] = ["welcome"];
export const DEFAULT_TEMPLATE: PopupTemplateKey = "welcome";

/** The template to show for a saved key. Keys no longer on offer fall back to the default. */
export const liveTemplate = (v: unknown): PopupTemplateKey =>
  isTemplateKey(v) && AVAILABLE_TEMPLATES.includes(v) ? v : DEFAULT_TEMPLATE;

export type PopupContent = {
  brandName: string;
  headline: string;
  subheadline: string;
  buttonLabel: string;
  legal: string;
  imageUrl: string | null;
  /** Welcome offer: rotating cards, one per line as "Title | description". */
  highlights: string;
  /** Welcome offer: privacy policy link at the end of the "Read details" view (https only). */
  detailsUrl: string | null;
  /** Welcome offer: full consent wording behind "Read details". Blank line = new paragraph. */
  consentDetails: string;
  /** Optional reward shown after sign-in. Empty code = no coupon screen. */
  couponCode: string;
  /** Line under "Apply code X", e.g. "to get 10% off at checkout". */
  couponHeadline: string;
  couponOffer: string;
  couponNote: string;
};

export const DEFAULT_PRIMARY = "#111827";

export const DEFAULT_CONTENT: PopupContent = {
  brandName: "",
  headline: "Login to Get 10% Off On Your First Order!",
  subheadline: "Unlock member offers and a faster checkout.",
  buttonLabel: "Continue",
  legal: "By continuing you agree to receive order updates and offers on WhatsApp. You can opt out at any time.",
  imageUrl: null,
  highlights: "Faster checkout | Your details are saved for next time.\nMember offers | Be the first to hear about new drops and deals.",
  detailsUrl: null,
  consentDetails:
    "I consent to this store collecting, processing and securely storing my personal data, including my contact details and shopping activity, for faster login and checkout, personalised offers, analytics and marketing, including on WhatsApp.\n\nMy data will be handled in accordance with the UAE Personal Data Protection Law (Federal Decree-Law No. 45 of 2021) and the store's privacy policy.\n\nI understand that I can withdraw my consent at any time.",
  couponCode: "",
  couponHeadline: "to use at checkout",
  couponOffer: "10% off your first order",
  couponNote: "Use it at checkout.",
};

/** "Title | description" lines -> cards (empty lines dropped, max 5). */
export function parseHighlights(raw: string): { title: string; body: string }[] {
  return raw
    .split("\n")
    .map((line) => {
      const [title = "", ...rest] = line.split("|");
      return { title: title.trim(), body: rest.join("|").trim() };
    })
    .filter((x) => x.title || x.body)
    .slice(0, 5);
}

export const HEX_RE = /^#[0-9a-f]{6}$/i;

const hex = (v: unknown): string | null => (typeof v === "string" && HEX_RE.test(v) ? v : null);

/**
 * Popup colour: the popup's own colour if the merchant picked one, else the store's
 * Branding colour from the dashboard. Blank used to be saved as DEFAULT_PRIMARY, so that
 * counts as "not picked".
 */
export function pickPrimary(popupColor: unknown, storeColor: unknown): string {
  const own = hex(popupColor);
  return (own && own.toLowerCase() !== DEFAULT_PRIMARY ? own : null) ?? hex(storeColor) ?? own ?? DEFAULT_PRIMARY;
}

/** Text colour on the brand colour (dashboard Branding "Accent"); null = pick black/white automatically. */
export const pickTextColor = (storeColor: unknown): string | null => hex(storeColor);

/** The store logo stands in for the popup image on templates that show it as a logo. */
export const LOGO_TEMPLATES: readonly PopupTemplateKey[] = ["welcome"];
export function withLogo(content: PopupContent, key: PopupTemplateKey, logoUrl: string | null): PopupContent {
  return !content.imageUrl && logoUrl && LOGO_TEMPLATES.includes(key) ? { ...content, imageUrl: logoUrl } : content;
}

/** Merge stored JSON over the defaults, ignoring unknown or wrongly-typed keys. */
export function resolveContent(raw: unknown, brandName = ""): PopupContent {
  const c: PopupContent = { ...DEFAULT_CONTENT, brandName };
  if (raw && typeof raw === "object") {
    for (const k of Object.keys(DEFAULT_CONTENT) as (keyof PopupContent)[]) {
      const v = (raw as Record<string, unknown>)[k];
      // Empty highlights means "no carousel"; any other empty field keeps its default
      if (typeof v === "string" && (v.trim() || k === "highlights")) (c as Record<string, unknown>)[k] = v.trim();
    }
  }
  if (c.imageUrl && !/^https:\/\//i.test(c.imageUrl)) c.imageUrl = null;
  if (c.detailsUrl && !/^https:\/\//i.test(c.detailsUrl)) c.detailsUrl = null;
  return c;
}

/** What the browser bundle needs to render a popup. */
export type PopupBootstrap = {
  /**
   * live     consent popup opened by onymous-consent.js (it owns placement + backdrop)
   * panel    /login inside the theme snippet's login panel (snippet owns the backdrop)
   * silent   /login?silent=1: recognise the device and report auth state, no UI
   * preview  dashboard gallery
   */
  mode: "live" | "panel" | "silent" | "preview";
  /**
   * panel only. auto: place the template like the dashboard preview and report the size
   * (onymous:ready / onymous:resize). fill: fill the host's own fixed sheet (legacy snippet).
   */
  placement?: "auto" | "fill";
  /** panel/silent: storefront origins allowed to receive messages (store's own domains). */
  allowedParents?: string[];
  shop: string | null;
  /** Storefront origin we may postMessage to (validated server-side). */
  parentOrigin: string | null;
  /** Dashboard origin allowed to drive previews via postMessage. */
  previewOrigin: string | null;
  templateKey: PopupTemplateKey;
  content: PopupContent;
  primaryColor: string;
  /** Text/icon colour on primaryColor (store Branding). Null: black or white, whichever reads better. */
  textColor?: string | null;
};
