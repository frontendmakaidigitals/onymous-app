/**
 * Origins a store's storefront can legitimately run on:
 * the myshopify domain plus the custom domain from websiteUrl (with/without www).
 */
export function storeOrigins(store: {
  shopDomain: string | null;
  websiteUrl: string | null;
}): string[] {
  const hosts = new Set<string>();
  if (store.shopDomain) hosts.add(store.shopDomain.toLowerCase());
  if (store.websiteUrl) {
    try {
      const raw = store.websiteUrl.startsWith("http")
        ? store.websiteUrl
        : `https://${store.websiteUrl}`;
      const h = new URL(raw).host.toLowerCase();
      hosts.add(h);
      hosts.add(h.startsWith("www.") ? h.slice(4) : `www.${h}`);
    } catch {}
  }
  return [...hosts].map((h) => `https://${h}`);
}

export function isStoreOrigin(
  origin: string | null | undefined,
  store: { shopDomain: string | null; websiteUrl: string | null }
): origin is string {
  if (!origin) return false;
  return storeOrigins(store).includes(origin.toLowerCase());
}