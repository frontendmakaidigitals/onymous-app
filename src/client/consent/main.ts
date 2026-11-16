// Entry for the consent popup iframe page (/embed/consent and /embed/consent/preview).
// Bundled by scripts/build-client.mjs into dist/public/consent.js.
//
// Live flow:  recognise device silently -> phone -> 6-digit code -> signed in
// Messages to the loader (public loader.ts) on the storefront:
//   onymous:ready {template}   show the iframe
//   onymous:close              shopper dismissed
//   onymous:done               shopper is identified (verified now, or recognised)
// GC_AUTH_STATE is also sent via parent-bridge so the storefront can sync carts.
import { h, onColor, renderTemplate } from "./dom";
import { isTemplateKey, type PopupBootstrap } from "@/lib/consent/templates";
import { notifyAuth } from "@/client/parent-bridge";
import { getFpRequestId, preloadFingerprint } from "@/client/fp-client";

const boot = JSON.parse(document.getElementById("onymous-bootstrap")!.textContent || "{}") as PopupBootstrap;
const root = document.getElementById("onymous-root")!;

const COUNTRY_CODES = ["+971", "+966", "+965", "+974", "+968", "+973", "+91"];

function post(msg: Record<string, unknown>) {
  if (boot.parentOrigin && window.parent !== window) window.parent.postMessage(msg, boot.parentOrigin);
}

function mount(body: HTMLElement, onClose?: () => void) {
  const card = renderTemplate(boot.templateKey, boot.content, boot.primaryColor, body, onClose);
  const placement =
    boot.mode === "preview" ? "oc-preview" : boot.templateKey === "compact" ? "oc-dock" : "oc-overlay";
  const wrap = h("main", { class: placement }, card);
  if (placement === "oc-overlay" && onClose) {
    wrap.addEventListener("click", (e) => e.target === wrap && onClose());
  }
  root.replaceChildren(wrap);
}

function button(label: string, attrs: Record<string, string | boolean | undefined> = {}) {
  return h(
    "button",
    { type: "submit", class: "oc-btn", style: `background:${boot.primaryColor};color:${onColor(boot.primaryColor)}`, ...attrs },
    label,
  );
}

async function api<T>(path: string, body: unknown): Promise<{ ok: boolean; status: number; data: T }> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  return { ok: r.ok, status: r.status, data: (await r.json().catch(() => ({}))) as T };
}

// ── Steps ─────────────────────────────────────────────────────────────────

function phoneStep(close: () => void, prefill?: { code: string; number: string }) {
  const select = h("select", { "aria-label": "Country code" });
  for (const c of COUNTRY_CODES) select.append(h("option", { value: c, selected: c === prefill?.code }, c));
  const input = h("input", {
    type: "tel",
    inputmode: "numeric",
    autocomplete: "tel-national",
    placeholder: "50 123 4567",
    "aria-label": "Phone number",
    value: prefill?.number,
  });
  const err = h("span", { class: "oc-err", role: "alert" });
  const submit = button(boot.content.buttonLabel);

  const form = h(
    "form",
    { class: "oc-form", novalidate: true },
    h("span", { class: "oc-field" }, select, input),
    submit,
    err,
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const digits = input.value.replace(/\D/g, "").replace(/^0+/, "");
    if (digits.length < 7 || digits.length > 12) {
      err.textContent = "Enter a valid phone number.";
      return;
    }
    const phone = `${select.value}${digits}`;
    submit.disabled = true;
    submit.textContent = "Sending code…";
    err.textContent = "";
    try {
      const res = await api<{ error?: string; retryAfter?: number }>("/api/auth/otp/send", { shop: boot.shop, phone });
      if (res.ok) return codeStep(close, phone, { code: select.value, number: input.value });
      err.textContent =
        res.data.error === "cooldown"
          ? `Please wait ${res.data.retryAfter ?? 60}s before requesting another code.`
          : res.data.error === "too_many"
            ? "Too many attempts. Please try again later."
            : "We couldn't send a code to that number.";
    } catch {
      err.textContent = "Something went wrong. Please try again.";
    }
    submit.disabled = false;
    submit.textContent = boot.content.buttonLabel;
  });

  mount(form, close);
  input.focus();
}

function codeStep(close: () => void, phone: string, prefill: { code: string; number: string }) {
  preloadFingerprint(); // so verify isn't slowed down

  const input = h("input", {
    class: "oc-code",
    type: "text",
    inputmode: "numeric",
    autocomplete: "one-time-code",
    maxlength: "6",
    placeholder: "••••••",
    "aria-label": "6-digit code",
  });
  const err = h("span", { class: "oc-err", role: "alert" });
  const submit = button("Verify");
  const resend = h("button", { type: "button", class: "oc-link", disabled: true }, "Resend code");
  const change = h("button", { type: "button", class: "oc-link", onClick: () => phoneStep(close, prefill) }, "Change number");

  let wait = 60;
  const tick = setInterval(() => {
    wait -= 1;
    resend.textContent = wait > 0 ? `Resend in ${wait}s` : "Resend code";
    resend.disabled = wait > 0;
    if (wait <= 0) clearInterval(tick);
  }, 1000);
  resend.textContent = `Resend in ${wait}s`;
  resend.addEventListener("click", async () => {
    resend.disabled = true;
    const res = await api<{ retryAfter?: number }>("/api/auth/otp/send", { shop: boot.shop, phone }).catch(() => null);
    err.textContent = res?.ok ? "" : "Couldn't resend yet. Try again in a minute.";
    wait = res?.data?.retryAfter ?? 60;
  });

  const form = h(
    "form",
    { class: "oc-form", novalidate: true },
    h("span", { class: "oc-row" }, h("span", {}, `Code sent to ${phone}`), change),
    h("span", { class: "oc-field" }, input),
    submit,
    err,
    h("span", { class: "oc-row" }, resend),
  );
  input.addEventListener("input", () => {
    input.value = input.value.replace(/\D/g, "").slice(0, 6);
    if (input.value.length === 6) form.requestSubmit();
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(input.value)) {
      err.textContent = "Enter the 6-digit code.";
      return;
    }
    submit.disabled = true;
    submit.textContent = "Verifying…";
    err.textContent = "";
    try {
      const fpRequestId = await getFpRequestId();
      const res = await api<{ token?: string; error?: string }>("/api/auth/otp/verify", {
        shop: boot.shop,
        phone,
        code: input.value,
        ...(fpRequestId ? { fpRequestId } : {}),
      });
      if (res.ok && res.data.token) {
        clearInterval(tick);
        return doneStep(res.data.token);
      }
      err.textContent =
        res.data.error === "expired"
          ? "That code has expired. Request a new one."
          : res.data.error === "locked"
            ? "Too many wrong attempts. Request a new code."
            : "That code isn't right. Please check and try again.";
    } catch {
      err.textContent = "Something went wrong. Please try again.";
    }
    submit.disabled = false;
    submit.textContent = "Verify";
  });

  mount(form, close);
  input.focus();
}

async function doneStep(token: string) {
  mount(
    h(
      "span",
      { class: "oc-ok", role: "status" },
      h("span", { class: "oc-ok-icon", style: `background:${boot.primaryColor};color:${onColor(boot.primaryColor)}` }, "✓"),
      "You're signed in",
    ),
  );
  await notifyAuth(true, token);
  setTimeout(() => post({ type: "onymous:done" }), 1200);
}

// ── Boot ──────────────────────────────────────────────────────────────────

async function startLive() {
  const close = () => post({ type: "onymous:close" });
  window.addEventListener("keydown", (e) => e.key === "Escape" && close());

  // Already trusted on this device? Identify silently and never show the popup.
  // Cookie only here; fingerprinting runs at verify time (it is billed per call).
  try {
    const r = await api<{ recognized?: boolean; token?: string }>("/api/auth/recognize", { shop: boot.shop });
    if (r.ok && r.data.recognized && r.data.token) {
      await notifyAuth(true, r.data.token);
      return post({ type: "onymous:done" });
    }
  } catch {}

  phoneStep(close);
  post({ type: "onymous:ready", template: boot.templateKey });
}

function startPreview() {
  const render = () => {
    const body = h(
      "span",
      { class: "oc-form" },
      h("span", { class: "oc-field" }, h("select", { tabindex: "-1" }, h("option", {}, "+971")), h("input", { placeholder: "50 123 4567", tabindex: "-1" })),
      button(boot.content.buttonLabel, { type: "button", tabindex: "-1" }),
    );
    mount(body, () => {});
  };
  render();

  // The dashboard pushes edits while the merchant types (Customize panel)
  window.addEventListener("message", (e) => {
    if (!boot.previewOrigin || e.origin !== boot.previewOrigin) return;
    const d = e.data as Partial<PopupBootstrap> & { type?: string };
    if (d?.type !== "onymous:preview") return;
    if (isTemplateKey(d.templateKey)) boot.templateKey = d.templateKey;
    if (d.content) {
      boot.content = { ...boot.content, ...d.content };
      if (boot.content.imageUrl && !/^https:\/\//i.test(boot.content.imageUrl)) boot.content.imageUrl = null;
    }
    if (typeof d.primaryColor === "string" && /^#[0-9a-f]{6}$/i.test(d.primaryColor)) boot.primaryColor = d.primaryColor;
    render();
  });
}

if (boot.mode === "preview") startPreview();
else void startLive();
