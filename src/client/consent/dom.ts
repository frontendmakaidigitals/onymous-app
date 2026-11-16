// Tiny DOM helpers + the three template shells. No framework: this runs on
// every storefront page view that shows the popup, so it stays small.
import type { PopupContent, PopupTemplateKey } from "@/lib/consent/templates";

type Attrs = Record<string, string | boolean | ((e: Event) => void) | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === "function") el.addEventListener(k.replace(/^on/, "").toLowerCase(), v);
    else if (k === "class") el.className = String(v);
    else if (k === "style") el.setAttribute("style", String(v));
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

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

function closeButton(onClose?: () => void) {
  return h(
    "button",
    { type: "button", class: "oc-close", "aria-label": "Close", onClick: onClose ? () => onClose() : undefined, tabindex: onClose ? undefined : "-1" },
    "✕",
  );
}

/** Merchant image, or abstract art in the brand colour. */
function art(content: PopupContent, primary: string) {
  if (content.imageUrl) {
    return h("span", { class: "oc-art" }, h("img", { src: content.imageUrl, alt: "", loading: "eager" }));
  }
  return h(
    "span",
    { class: "oc-art", "aria-hidden": "true", style: `background:linear-gradient(150deg,${primary}22,${primary}55)` },
    h("span", { class: "oc-blob", style: `left:-40px;top:24px;width:160px;height:160px;opacity:.6;background:${primary}55` }),
    h("span", { class: "oc-blob", style: `right:-20%;bottom:-48px;width:224px;height:224px;opacity:.5;background:${primary}40` }),
    h("span", { class: "oc-blob", style: "left:33%;top:50%;width:64px;height:64px;border-radius:18px;transform:rotate(12deg);background:rgba(255,255,255,.5)" }),
  );
}

function heading(content: PopupContent, brandClass = "oc-brand") {
  return [
    content.brandName ? h("span", { class: brandClass }, content.brandName) : null,
    h("p", { class: "oc-h", id: "oc-title" }, content.headline),
    h("p", { class: "oc-sub" }, content.subheadline),
  ];
}

/**
 * Builds a template around `body` (the current step: phone form, code form, success).
 * Returns the card element; placement (overlay / dock / preview) is the caller's job.
 */
export function renderTemplate(
  key: PopupTemplateKey,
  content: PopupContent,
  primary: string,
  body: HTMLElement,
  onClose?: () => void,
): HTMLElement {
  const legal = h("p", { class: "oc-legal" }, content.legal);
  const dialog = { role: "dialog", "aria-modal": "true", "aria-labelledby": "oc-title" };

  if (key === "compact") {
    return h("section", { class: "oc-card oc-compact", ...dialog }, closeButton(onClose), ...heading(content), body, legal);
  }
  if (key === "split") {
    return h(
      "section",
      { class: "oc-card oc-split", ...dialog },
      art(content, primary),
      h("span", { class: "oc-pane" }, closeButton(onClose), ...heading(content), body, legal),
    );
  }
  return h(
    "section",
    { class: "oc-spot", ...dialog },
    art(content, primary),
    h("span", { class: "oc-shade" }),
    h("span", { class: "oc-stage" }, h("span", { class: "oc-glass" }, closeButton(onClose), ...heading(content), body, legal)),
  );
}
