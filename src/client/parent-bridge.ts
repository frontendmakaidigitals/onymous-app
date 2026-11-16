function parentOrigin(): string {
  if (typeof window === "undefined") return "";
  let origin = window.location.ancestorOrigins?.[0] || "";
  if (!origin) {
    try { origin = new URL(document.referrer).origin; } catch {}
  }
  return origin;
}

async function fetchCartToken(sessionToken: string, origin: string): Promise<string | null> {
  try {
    const r = await fetch("/api/storefront/cart-token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ parentOrigin: origin }),
      cache: "no-store",
    });
    if (!r.ok) return null;
    const d = await r.json();
    return typeof d?.cartToken === "string" ? d.cartToken : null;
  } catch {
    return null;
  }
}

/**
 * Tells the storefront whether the customer is recognised.
 * When a session token is passed, also hands over a cart token so the
 * storefront can sync add-to-cart into AbandonedCart.
 */
export async function notifyAuth(loggedIn: boolean, sessionToken?: string | null) {
  if (typeof window === "undefined" || window.parent === window) return;
  const origin = parentOrigin();
  if (!origin) return;

  const cartToken =
    loggedIn && sessionToken ? await fetchCartToken(sessionToken, origin) : null;

  window.parent.postMessage({ type: "GC_AUTH_STATE", loggedIn, cartToken }, origin);
}