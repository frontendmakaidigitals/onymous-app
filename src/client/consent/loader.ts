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
  // Debugging on a storefront: add ?onymous_debug=1 to the URL (logs every step)
  // and ?onymous_reset=1 to forget a previous dismiss / sign-in on this browser.
  const params = new URLSearchParams(location.search);
  const debug = params.has("onymous_debug");
  const log = (...a: unknown[]) => debug && console.info("[onymous]", ...a);

  if (window.__onymousConsent) return log("loader already ran on this page, skipping");
  window.__onymousConsent = true;

  const script = document.currentScript as HTMLScriptElement | null;
  const shop = script?.getAttribute("data-shop");
  if (!script || !shop) {
    return console.warn("[onymous] consent loader: missing data-shop on the <script> tag");
  }

  const base = new URL(script.src).origin;
  log("loader running", { shop, onymousApp: base, pageOrigin: location.origin });
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

  if (params.has("onymous_reset")) {
    try {
      localStorage.removeItem(KEY);
    } catch {}
    log("reset: cleared dismiss / sign-in state");
  }

  const state = read();
  if (state.done) return log("not showing: shopper already signed in on this browser (add ?onymous_reset=1)");
  if (state.dismissedAt && Date.now() - state.dismissedAt < SNOOZE_MS) {
    return log("not showing: dismissed recently (add ?onymous_reset=1)");
  }

  let frame: HTMLIFrameElement | null = null;

  function close() {
    window.removeEventListener("message", onMessage);
    frame?.remove();
    frame = null;
  }

  function onMessage(e: MessageEvent) {
    if (!frame || e.origin !== base || e.source !== frame.contentWindow) return;
    const msg = (e.data ?? {}) as { type?: string; template?: string; height?: number };
    log("message from popup", msg);

    if (msg.type === "onymous:ready") {
      readyTimer && clearTimeout(readyTimer);
      // Docked templates: shrink the iframe to the card so the rest of the page stays clickable.
      // Height starts generous and is corrected by onymous:resize.
      if (msg.template === "compact") {
        Object.assign(frame.style, { inset: "auto 0 0 auto", width: "min(420px, 100vw)", height: "520px" });
      } else if (msg.template === "banner") {
        Object.assign(frame.style, { inset: "auto 0 0 0", width: "100%", height: "220px" });
      }
      frame.style.visibility = "visible";
    } else if (msg.type === "onymous:resize" && typeof msg.height === "number") {
      frame.style.height = `${Math.min(Math.max(msg.height, 80), window.innerHeight)}px`;
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
    log("iframe added", frame.src);
    readyTimer = setTimeout(
      () =>
        console.warn(
          "[onymous] popup iframe did not report ready within 10s. Open DevTools > Network and check the " +
            "/embed/consent request (blocked by frame-ancestors? page origin not the store's shopDomain/websiteUrl?)",
        ),
      10_000,
    );
  }
  let readyTimer: ReturnType<typeof setTimeout> | null = null;

  const configUrl = `${base}/api/public/consent-popup?shop=${encodeURIComponent(shop)}`;
  log("fetching config", configUrl);
  fetch(configUrl, { credentials: "omit" })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<{ enabled?: boolean; templateKey?: string }>;
    })
    .then((cfg) => {
      log("config", cfg);
      if (!cfg?.enabled) return log("not showing: popup is off for this shop (activate a template in the dashboard)");
      setTimeout(open, SHOW_DELAY_MS);
    })
    .catch((err) =>
      console.warn("[onymous] could not load popup config (is onymous-app reachable at", base, "?)", err),
    );
})();

export {};
