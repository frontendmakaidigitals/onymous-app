// lib/abandoned-cart.ts
// Single write path for abandoned carts. Storefront cart sync and checkout phone entry
// both land here — a cart from a known phone IS an abandoned checkout.
import { prisma } from "@/lib/prisma";

export type CartSource = "cart" | "checkout";
export type PurchaseAttribution = "recovered" | "assisted" | "influenced" | "organic";

/** Canonical item shape = the checkout-token payload shape the theme sends. Prices in major units. */
export type RecoveryItem = {
  product_title: string;
  variant_title: string | null;
  quantity: number;
  original_price: number;
  compare_at_price?: number;
  image: string | null;
  variant_id: string;
  product_id: number | null;
  collection_ids: number[];
  sku: string | null;
  handle: string | null;
};

const MAX_ITEMS = 100;
const RESEND_COOLDOWN_MS = Number(process.env.CART_RECOVERY_RESEND_COOLDOWN_HOURS ?? 8) * 3600_000;

function num(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

/** Shopify cart tokens come as "<token>?key=<secret>" from /cart.js; orders carry only "<token>". */
export function baseCartToken(t: unknown): string | null {
  const s = str(t, 200);
  return s ? (s.split("?")[0] ?? null) : null;
}

/** Phone variants to match against stored E.164 phones ("+9715…"). */
export function phoneCandidates(...raw: unknown[]): string[] {
  const out = new Set<string>();
  for (const r of raw) {
    if (typeof r !== "string") continue;
    let p = r.replace(/[^\d+]/g, "");
    if (!p) continue;
    if (p.startsWith("00")) p = "+" + p.slice(2);
    out.add(p);
    if (!p.startsWith("+")) out.add("+" + p);
  }
  return [...out];
}

/**
 * Accepts any of the shapes we've stored over time and returns the canonical one:
 *  - checkout payload  { variant_id, original_price, product_title, ... }  (major units)
 *  - old storefront    { variantId, price, title, variantTitle, ... }      (major units)
 *  - old cart-track    { variant_id, original_price, product_title, ... }  (major units)
 * Callers must pass major units.
 */
export function normalizeItems(raw: unknown): RecoveryItem[] {
  if (!Array.isArray(raw)) return [];
  const out: RecoveryItem[] = [];

  for (const r of raw.slice(0, MAX_ITEMS)) {
    if (!r || typeof r !== "object") continue;
    const i = r as Record<string, unknown>;

    const variantId = num(i.variant_id ?? i.variantId);
    const quantity = num(i.quantity);
    const price = num(i.original_price ?? i.price);
    if (!variantId || quantity === null || !Number.isInteger(quantity) || quantity <= 0) continue;
    if (price === null || price < 0) continue;

    const compareAt = num(i.compare_at_price ?? i.compareAtPrice);
    const variantTitle = str(i.variant_title ?? i.variantTitle, 200);
    const collectionIds = Array.isArray(i.collection_ids)
      ? (i.collection_ids as unknown[]).map(num).filter((n): n is number => n !== null)
      : [];

    out.push({
      product_title: str(i.product_title ?? i.title, 300) ?? "",
      variant_title: variantTitle === "Default Title" ? null : variantTitle,
      quantity,
      original_price: Math.round(price * 100) / 100,
      ...(compareAt !== null && compareAt > price
        ? { compare_at_price: Math.round(compareAt * 100) / 100 }
        : {}),
      image: str(i.image, 1000),
      variant_id: String(variantId),
      product_id: num(i.product_id ?? i.productId),
      collection_ids: collectionIds,
      sku: str(i.sku, 100),
      handle: str(i.handle, 300),
    });
  }
  return out;
}

export function itemsTotal(items: RecoveryItem[]): number {
  return Math.round(items.reduce((s, i) => s + i.original_price * i.quantity, 0) * 100) / 100;
}

function toOrigin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    return null;
  }
}

/** Merchant storefront origin for recovery links: Bitespeed recoveryDomain -> websiteUrl -> shopDomain. */
export async function recoveryBase(shop: string): Promise<string> {
  const [integration, store] = await Promise.all([
    prisma.bitespeedIntegration.findUnique({
      where: { shop },
      select: { recoveryDomain: true },
    }),
    prisma.store.findUnique({
      where: { shopDomain: shop },
      select: { websiteUrl: true },
    }),
  ]);
  return (
    toOrigin(integration?.recoveryDomain) ??
    toOrigin(store?.websiteUrl) ??
    `https://${shop}`
  );
}

/**
 * One link format for every store: https://store/?gc_recover=<id>
 * The storefront snippet decides at click time:
 *   GulfCart checkout live -> opens the GulfCart overlay prefilled
 *   GulfPass only / native -> redirects to nativeCheckoutPath() (Shopify checkout, prefilled)
 * Landing on a store page first is what lets us record the click.
 */
export function buildRecoveryLink(base: string, id: string) {
  return `${base}/?gc_recover=${encodeURIComponent(id)}`;
}

/**
 * Shopify cart permalink (relative, so it stays on whatever domain the customer is on).
 * attributes[gc_recover] becomes a cart attribute -> order note_attributes, which the
 * orders/create webhook reads to attribute the order to this exact recovery.
 */
export function nativeCheckoutPath(row: {
  id: string;
  items: RecoveryItem[];
  email?: string | null;
  name?: string | null;
  phone?: string | null;
}) {
  const lines = row.items.map((i) => `${i.variant_id}:${i.quantity}`).join(",");
  const q = new URLSearchParams();
  if (row.email) q.set("checkout[email]", row.email);
  if (row.name) {
    const [first, ...rest] = row.name.trim().split(/\s+/);
    q.set("checkout[shipping_address][first_name]", first ?? "");
    if (rest.length) q.set("checkout[shipping_address][last_name]", rest.join(" "));
  }
  if (row.phone) q.set("checkout[shipping_address][phone]", row.phone);
  q.set("attributes[gc_recover]", row.id);
  return `/cart/${lines}?${q.toString()}`;
}

/** Fields reset when a purchased row gets new cart activity (new abandonment cycle). */
const NEW_CYCLE = {
  isPurchased: false,
  purchasedAt: null,
  purchaseOrderId: null,
  purchaseAttribution: null,
  purchaseGateway: null,
  purchaseTotal: null,
  purchaseCurrency: null,
  abandonedAttempts: 0,
  abandonedError: null,
  abandonedSentAt: null,
  lastAbandonedSentAt: null,
  recoveryClickedAt: null,
  deliveredAt: null,
  readAt: null,
  deliveryFailedAt: null,
  deliveryError: null,
  deliveryStatus: null,
} as const;

export type UpsertAbandonedCartInput = {
  shop: string;
  phone: string;
  source: CartSource;
  items: unknown; // any shape normalizeItems accepts, major units
  currency: string;
  total?: number | null; // major units; recomputed from items when missing/invalid
  cartToken?: string | null;
  customerId?: string | null;
  email?: string | null;
  name?: string | null;
  fpVisitorId?: string | null;
};

/**
 * The only function that writes cart contents.
 * - Latest items/total win.
 * - Identity fields (name/email/customerId/fpVisitorId) are only filled, never nulled.
 * - source escalates cart -> checkout within a cycle, never back.
 * - Every call moves lastActivityAt (resets the send timer).
 * - Empty cart clears the row instead (no send).
 */
export async function upsertAbandonedCart(input: UpsertAbandonedCartInput) {
  const shop = input.shop;
  const phone = input.phone;
  const items = normalizeItems(input.items);

  if (!items.length) {
    await clearAbandonedCart(shop, phone, input.cartToken ?? null);
    return null;
  }

  const total =
    typeof input.total === "number" && Number.isFinite(input.total) && input.total >= 0
      ? Math.round(input.total * 100) / 100
      : itemsTotal(items);
  const currency = String(input.currency || "AED").slice(0, 3).toUpperCase();

  const existing = await prisma.abandonedCart.findUnique({
    where: { shop_phone: { shop, phone } },
    select: {
      isPurchased: true,
      abandonedSentAt: true,
      source: true,
      email: true,
      name: true,
      customerId: true,
      fpVisitorId: true,
      cartToken: true,
    },
  });

  const cooledDown =
    !!existing?.abandonedSentAt &&
    Date.now() - existing.abandonedSentAt.getTime() > RESEND_COOLDOWN_MS;
  const newCycle = !existing || existing.isPurchased || cooledDown;
  const source: CartSource =
    !newCycle && existing?.source === "checkout" ? "checkout" : input.source;

  const identity = {
    email: str(input.email, 320) ?? existing?.email ?? null,
    name: str(input.name, 200) ?? existing?.name ?? null,
    customerId: str(input.customerId, 64) ?? existing?.customerId ?? null,
    fpVisitorId: str(input.fpVisitorId, 128) ?? existing?.fpVisitorId ?? null,
    cartToken: baseCartToken(input.cartToken) ?? existing?.cartToken ?? null,
  };

  const contents = {
    items,
    total,
    currency,
    source,
    lastActivityAt: new Date(),
    ...identity,
  };

  const row = await prisma.abandonedCart.upsert({
    where: { shop_phone: { shop, phone } },
    create: { shop, phone, ...contents },
    update: { ...contents, ...(existing && newCycle ? NEW_CYCLE : {}) },
    select: { id: true, recoveryLink: true },
  });

  const link = buildRecoveryLink(await recoveryBase(shop), row.id);
  if (row.recoveryLink !== link) {
    await prisma.abandonedCart.update({
      where: { id: row.id },
      data: { recoveryLink: link },
    });
  }

  return { id: row.id, recoveryLink: link, source };
}

/** Cart emptied: keep the row (and its stats), but there's nothing to recover. */
export async function clearAbandonedCart(shop: string, phone: string, cartToken: string | null) {
  const token = baseCartToken(cartToken);
  await prisma.abandonedCart.updateMany({
    where: { shop, phone, isPurchased: false },
    data: {
      items: [],
      total: 0,
      lastActivityAt: new Date(),
      ...(token ? { cartToken: token } : {}),
    },
  });
}

/**
 * How a purchase relates to our recovery flow:
 *   recovered  — order carries this row's gc_recover id (bought through the link)
 *   assisted   — clicked the link earlier, then bought another way
 *   influenced — message was sent, never clicked, bought anyway
 *   organic    — bought before any message went out
 */
export function attributePurchase(
  row: { id: string; recoveryClickedAt: Date | null; abandonedSentAt: Date | null; deliveryStatus?: string | null },
  recoveryCartId: string | null,
): PurchaseAttribution {
  if (recoveryCartId && recoveryCartId === row.id) return "recovered";
  // Sent to the provider AND not reported failed (status webhook)
  const messaged = !!row.abandonedSentAt && row.deliveryStatus !== "failed";
  if (messaged && row.recoveryClickedAt && row.recoveryClickedAt >= row.abandonedSentAt!) return "assisted";
  if (messaged) return "influenced";
  return "organic";
}
/**
 * Call from every order path: GulfCart order success (all providers + COD) and the
 * Shopify orders/create webhook (native checkout, Shop Pay, draft, POS).
 * Matches on any of: recovery id, phone(s), cart token, email. Idempotent: rows already
 * closed are skipped, so a webhook arriving after the GulfCart path changes nothing.
 * Returns the closed rows with their attribution.
 */
export async function markAbandonedCartPurchased(args: {
  shop: string;
  orderId?: string | number | null;
  phone?: string | null;
  phones?: string[];
  email?: string | null;
  cartToken?: string | null;
  recoveryCartId?: string | null;
  gateway?: string | null; // payment method, e.g. "bogus", "Cash on Delivery (COD)", "tabby"
  orderTotal?: number | null; // major units, as charged
  orderCurrency?: string | null;
}) {
  const phones = phoneCandidates(args.phone, ...(args.phones ?? []));
  const token = baseCartToken(args.cartToken);
  const email = str(args.email, 320)?.toLowerCase() ?? null;
  const recoveryCartId = str(args.recoveryCartId, 64);

  const or: object[] = [];
  if (recoveryCartId) or.push({ id: recoveryCartId });
  if (phones.length) or.push({ phone: { in: phones } });
  if (token) or.push({ cartToken: { startsWith: token } }); // legacy rows stored "?key=" suffix
  if (email) or.push({ email: { equals: email, mode: "insensitive" } });
  if (!or.length) return [];

  const rows = await prisma.abandonedCart.findMany({
    where: { shop: args.shop, isPurchased: false, OR: or },
    select: { id: true, recoveryClickedAt: true, abandonedSentAt: true },
  });

  const now = new Date();
  const orderId = args.orderId != null ? String(args.orderId) : null;
  const orderTotal =
    typeof args.orderTotal === "number" && Number.isFinite(args.orderTotal)
      ? args.orderTotal
      : null;
  const purchase = {
    purchaseGateway: str(args.gateway, 200),
    purchaseTotal: orderTotal,
    purchaseCurrency: str(args.orderCurrency, 3)?.toUpperCase() ?? null,
  };
  const closed: { id: string; attribution: PurchaseAttribution; deleted: boolean }[] = [];

  for (const row of rows) {
    let attribution = attributePurchase(row, recoveryCartId);

    // Bought in the same funnel, before any message or click: nothing to recover, drop the row.
    if (attribution === "organic") {
      const { count } = await prisma.abandonedCart.deleteMany({
        where: { id: row.id, isPurchased: false, abandonedSentAt: null },
      });
      if (count) {
        closed.push({ id: row.id, attribution, deleted: true });
        continue;
      }
      // A message went out between the read and the delete: keep the row, count it as influenced.
      attribution = "influenced";
    }

    // isPurchased: false in the where -> a concurrent webhook/order path can't double-close
    const { count } = await prisma.abandonedCart.updateMany({
      where: { id: row.id, isPurchased: false },
      data: {
        isPurchased: true,
        purchasedAt: now,
        purchaseOrderId: orderId,
        purchaseAttribution: attribution,
        ...purchase,
      },
    });
    if (count) closed.push({ id: row.id, attribution, deleted: false });
  }

  return closed;
}

export async function markRecoveryClicked(id: string) {
  const row = await prisma.abandonedCart.findUnique({
    where: { id },
    select: { recoveryClickedAt: true, abandonedSentAt: true },
  });
  if (!row) return;

  const stale =
    !!row.recoveryClickedAt && !!row.abandonedSentAt && row.recoveryClickedAt < row.abandonedSentAt;
  if (row.recoveryClickedAt && !stale) return; // first real click already recorded

  // Conditional on the value we read, so two simultaneous clicks don't both write
  await prisma.abandonedCart.updateMany({
    where: { id, recoveryClickedAt: row.recoveryClickedAt },
    data: { recoveryClickedAt: new Date() },
  });
}

/**
 * Rows due for the recovery message: open, non-empty, inactive for `delayMinutes`,
 * not yet sent this cycle. One message per cycle, same for cart and checkout.
 */
export async function findDueAbandonedCarts(args: {
  shop: string;
  delayMinutes: number;
  limit?: number;
}) {
  const cutoff = new Date(Date.now() - args.delayMinutes * 60_000);
  return prisma.abandonedCart.findMany({
    where: {
      shop: args.shop,
      isPurchased: false,
      total: { gt: 0 },
      abandonedSentAt: null,
      lastActivityAt: { lte: cutoff },
    },
    orderBy: { lastActivityAt: "asc" },
    take: args.limit ?? 100,
  });
}