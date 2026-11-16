// Storefront loader, served as /onymous-consent.js. The theme only carries:
//   <script src="https://<onymous-app>/onymous-consent.js" data-shop="{{ shop.permanent_domain }}" defer></script>
// It asks onymous-app whether the shop's popup is on, then opens /embed/consent in an iframe.
//
// Window events for the theme:
//   "onymous:identified"  the shopper signed in (or was recognised on this device)

declare global {
  interface Window {
    __onymousConsent?: boolean;
  }
}

(function () {
  if (window.__onymousConsent) return;
  window.__onymousConsent = true;

  const script = document.currentScript as HTMLScriptElement | null;
  const shop = script?.getAttribute("data-shop");
  if (!script || !shop) return;

  const base = new URL(script.src).origin;
  const SHOW_DELAY_MS = 3000;
  const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000; // after a dismiss, stay quiet for 7 days
  const KEY = `onymous-consent:${shop}`;

  type State = { done?: boolean; dismissedAt?: number };
  const read = (): State => {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "{}") as State;
    } catch {
      return {};
    }
  };
  const write = (patch: State) => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...read(), ...patch }));
    } catch {}
  };

  const state = read();
  if (state.done) return;
  if (state.dismissedAt && Date.now() - state.dismissedAt < SNOOZE_MS) return;

  let frame: HTMLIFrameElement | null = null;

  function close() {
    window.removeEventListener("message", onMessage);
    frame?.remove();
    frame = null;
  }

  function onMessage(e: MessageEvent) {
    if (!frame || e.origin !== base || e.source !== frame.contentWindow) return;
    const msg = (e.data ?? {}) as { type?: string; template?: string };

    if (msg.type === "onymous:ready") {
      if (msg.template === "compact") {
        // Corner card: shrink the iframe so the rest of the page stays clickable
        Object.assign(frame.style, { inset: "auto 0 0 auto", width: "min(420px, 100vw)", height: "520px" });
      }
      frame.style.visibility = "visible";
    } else if (msg.type === "onymous:close") {
      write({ dismissedAt: Date.now() });
      close();
    } else if (msg.type === "onymous:done") {
      write({ done: true });
      close();
      window.dispatchEvent(new CustomEvent("onymous:identified"));
    }
  }

  function open() {
    frame = document.createElement("iframe");
    frame.title = "Sign in";
    frame.src = `${base}/embed/consent?shop=${encodeURIComponent(shop!)}&origin=${encodeURIComponent(location.origin)}`;
    frame.setAttribute("allowtransparency", "true");
    // Hidden until the popup says it rendered (and never shown for recognised shoppers)
    frame.style.cssText =
      "position:fixed;inset:0;width:100%;height:100%;border:0;background:transparent;" +
      "z-index:2147483647;visibility:hidden;color-scheme:normal";
    window.addEventListener("message", onMessage);
    document.body.appendChild(frame);
  }

  fetch(`${base}/api/public/consent-popup?shop=${encodeURIComponent(shop)}`, { credentials: "omit" })
    .then((r) => (r.ok ? r.json() : null))
    .then((cfg: { enabled?: boolean } | null) => {
      if (cfg?.enabled) setTimeout(open, SHOW_DELAY_MS);
    })
    .catch(() => {});
})();

export {};
