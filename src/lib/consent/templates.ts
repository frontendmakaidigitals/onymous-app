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
] as const;

export type PopupTemplateKey = (typeof POPUP_TEMPLATES)[number]["key"];

export const isTemplateKey = (v: unknown): v is PopupTemplateKey =>
  POPUP_TEMPLATES.some((t) => t.key === v);

export type PopupContent = {
  brandName: string;
  headline: string;
  subheadline: string;
  buttonLabel: string;
  legal: string;
  imageUrl: string | null;
};

export const DEFAULT_PRIMARY = "#111827";

export const DEFAULT_CONTENT: PopupContent = {
  brandName: "",
  headline: "Sign in with your phone",
  subheadline: "Unlock member offers and a faster checkout.",
  buttonLabel: "Continue",
  legal: "By continuing you agree to receive order updates and offers on WhatsApp. You can opt out at any time.",
  imageUrl: null,
};

export const HEX_RE = /^#[0-9a-f]{6}$/i;

/** Merge stored JSON over the defaults, ignoring unknown or wrongly-typed keys. */
export function resolveContent(raw: unknown, brandName = ""): PopupContent {
  const c: PopupContent = { ...DEFAULT_CONTENT, brandName };
  if (raw && typeof raw === "object") {
    for (const k of Object.keys(DEFAULT_CONTENT) as (keyof PopupContent)[]) {
      const v = (raw as Record<string, unknown>)[k];
      if (typeof v === "string" && v.trim()) (c as Record<string, unknown>)[k] = v.trim();
    }
  }
  if (c.imageUrl && !/^https:\/\//i.test(c.imageUrl)) c.imageUrl = null;
  return c;
}

/** What the browser bundle needs to render a popup. */
export type PopupBootstrap = {
  mode: "live" | "preview";
  shop: string | null;
  /** Storefront origin we may postMessage to (validated server-side). */
  parentOrigin: string | null;
  /** Dashboard origin allowed to drive previews via postMessage. */
  previewOrigin: string | null;
  templateKey: PopupTemplateKey;
  content: PopupContent;
  primaryColor: string;
};
