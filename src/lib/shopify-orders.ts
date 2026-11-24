// src/lib/shopify-orders.ts (port of onymous-dashboard lib/shopify/orders.ts: keep both in sync)
//
// Shopify orders -> stores."Order". Used by the orders webhook
// (src/routes/webhooks/shopify/orders) and the backfill script
// (script/sync-shopify-orders.ts), so both write rows the same way.
//
// - Every order is saved (store orders/revenue). Order.attribution records whether it
//   is tied to a WhatsApp recovery message (Zoko-style), else null:
//     link:  the checkout the link opened carries attributes[gc_recover]=<AbandonedCart.id>
//            (onymous-app nativeCheckoutPath), copied to the order's note_attributes;
//            the cart is marked recovered.
//            Counts even when that cart row no longer exists.
//     message: the order's phone was sent a recovery message in the ORDER_ATTRIBUTION_DAYS
//            (default 1) before the order; the cart is marked assisted (clicked) or influenced.
// - One row per Shopify order, keyed by (storeId, shopifyOrderId = the order's GID).
// - paidTotal is current_total_price in the shop's currency, so refunds and
//   order edits are reflected the next time Shopify sends orders/updated.
// - Cancelled and test orders are not sales: their row is removed / never written.
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

export const SHOPIFY_API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || "2025-10";

export const ORDER_WEBHOOK_PATH = "/api/webhooks/shopify/orders";
export const ORDER_WEBHOOK_TOPICS = ["orders/create", "orders/updated", "orders/cancelled", "refunds/create"] as const;

type Money = string | number | null | undefined;
export type ShopifyOrder = {
  id: number;
  admin_graphql_api_id?: string;
  name?: string;
  created_at: string;
  cancelled_at?: string | null;
  test?: boolean;
  note_attributes?: { name?: string; value?: unknown }[];
  landing_site?: string | null;
  currency?: string;
  presentment_currency?: string;
  current_total_price?: Money;
  total_price?: Money;
  total_tax?: Money;
  current_total_tax?: Money;
  total_discounts?: Money;
  payment_gateway_names?: string[];
  discount_codes?: { code?: string }[];
  email?: string | null;
  phone?: string | null;
  customer?: { first_name?: string | null; last_name?: string | null; email?: string | null; phone?: string | null } | null;
  billing_address?: { name?: string | null; phone?: string | null } | null;
  shipping_address?: { name?: string | null; phone?: string | null } | null;
  shipping_lines?: { code?: string | null; price?: Money }[];
  total_shipping_price_set?: { shop_money?: { amount?: Money } };
  line_items?: {
    product_id?: number | null;
    variant_id?: number | null;
    title?: string;
    variant_title?: string | null;
    sku?: string | null;
    quantity?: number;
    price?: Money;
  }[];
};

export type OrderStore = { id: string; shopDomain: string; currency: string };

const num = (v: Money) => {
  const n = typeof v === "number" ? v : parseFloat(v ?? "");
  return Number.isFinite(n) ? n : 0;
};
const orderGid = (o: ShopifyOrder) => o.admin_graphql_api_id ?? `gid://shopify/Order/${o.id}`;

/** Verifies X-Shopify-Hmac-Sha256 against the raw request body. */
export function verifyShopifyHmac(rawBody: string, hmacHeader: string | null, secret: string) {
  if (!hmacHeader || !secret) return false;
  const digest = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const given = Buffer.from(hmacHeader, "base64");
  return given.length === digest.length && crypto.timingSafeEqual(given, digest);
}

function toRow(store: OrderStore, o: ShopifyOrder) {
  const customerName =
    [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(" ") ||
    o.billing_address?.name ||
    o.shipping_address?.name ||
    null;
  const shippingCost =
    o.total_shipping_price_set?.shop_money?.amount != null
      ? num(o.total_shipping_price_set.shop_money.amount)
      : (o.shipping_lines ?? []).reduce((s, l) => s + num(l.price), 0);

  // The overview sums paidTotal * conversionRateAtPayment in the store currency.
  // Shopify amounts are in the shop currency, which is the store currency.
  if (o.currency && o.currency !== store.currency) {
    console.warn(
      `[shopify-orders] ${store.shopDomain} order ${o.id} is in ${o.currency}, store currency is ${store.currency}`,
    );
  }

  return {
    storeId: store.id,
    shop: store.shopDomain,
    shopifyOrderId: orderGid(o),
    shopifyOrderNumericId: String(o.id),
    paymentMethod: o.payment_gateway_names?.filter(Boolean).join(", ") || "unknown",
    items: (o.line_items ?? []).map((li) => ({
      product_id: li.product_id ?? null,
      variant_id: li.variant_id ?? null,
      product_title: li.title ?? null,
      variant_title: li.variant_title ?? null,
      sku: li.sku ?? null,
      quantity: li.quantity ?? 1,
      price: num(li.price),
    })) as Prisma.InputJsonValue,
    shippingCost,
    shippingHandle: o.shipping_lines?.[0]?.code ?? null,
    currency: o.currency ?? store.currency,
    paidCurrency: o.presentment_currency ?? o.currency ?? store.currency,
    paidTotal: num(o.current_total_price ?? o.total_price),
    conversionRateAtPayment: 1,
    vatAmount: num(o.current_total_tax ?? o.total_tax),
    discountCode: o.discount_codes?.[0]?.code ?? null,
    discountAmountDisplay: num(o.total_discounts),
    customerName,
    customerEmail: o.email ?? o.customer?.email ?? null,
    customerPhone: o.phone ?? o.customer?.phone ?? o.billing_address?.phone ?? o.shipping_address?.phone ?? null,
    createdAt: new Date(o.created_at),
  };
}

/** The AbandonedCart id this order was recovered through, if it came via a recovery link. */
export function recoveryCartId(o: ShopifyOrder): string | null {
  const attr = o.note_attributes?.find((a) => a?.name === "gc_recover")?.value;
  if (typeof attr === "string" && attr.trim()) return attr.trim();
  // Overlay links land on /?gc_recover=<id>; Shopify keeps the landing URL on the order
  const m = o.landing_site?.match(/[?&]gc_recover=([^&#]+)/);
  return m ? decodeURIComponent(m[1] ?? "") : null;
}

/**
 * Test orders (payment gateway in test mode) are not sales, so they are skipped like cancelled
 * ones. SHOPIFY_INCLUDE_TEST_ORDERS=1 counts them, for trying the recovery flow on a dev store.
 */
export const INCLUDE_TEST_ORDERS = process.env.SHOPIFY_INCLUDE_TEST_ORDERS === "1";
const notASale = (o: ShopifyOrder) => !!o.cancelled_at || (!!o.test && !INCLUDE_TEST_ORDERS);

export type SyncResult = "created" | "updated" | "removed" | "skipped";

/**
 * Days after a recovery message in which an order by the same phone still counts.
 * 1 day reproduces Zoko's "Ordered" count (checked on Teeser: 27 orders within a day of a
 * message + 6 link-only = Zoko's 33).
 */
export const ATTRIBUTION_DAYS = Number(process.env.ORDER_ATTRIBUTION_DAYS || 1);

type Db = Pick<typeof prisma, "$queryRaw" | "abandonedCart" | "recoveryEvent">;

/**
 * How an order is tied to an Onymous recovery message, if at all.
 *   link:    the order carries the gc_recover tag; id is null when the cart row no longer exists
 *   message: bought after a recovery message without the link. table/id name the cart or
 *            product view to close when known (null when matched from the provider's event log).
 *   source:  what proved it (tag | provider conversion | provider delivery | cart send time)
 */
export type Attribution =
  | { via: "link"; table: "cart"; id: string | null; source: "tag" }
  | {
      via: "message";
      table: "cart" | "browse" | null;
      id: string | null;
      clicked: boolean;
      source: "conversion" | "delivery" | "cart";
    };

/** Last 9 digits of every phone on the order (ignores +971 / 0 prefix differences). */
function orderPhoneKeys(o: ShopifyOrder): string[] {
  const raw = [o.phone, o.customer?.phone, o.billing_address?.phone, o.shipping_address?.phone];
  const keys = raw.map((p) => (p ?? "").replace(/\D/g, "")).filter((d) => d.length >= 8).map((d) => d.slice(-9));
  return [...new Set(keys)];
}

/**
 * In order of strength:
 * 1. link:  the order carries gc_recover (checkout opened by the recovery link). It counts
 *           even if the cart row is gone (onymous-app deletes carts it closes as organic).
 * 2. conversion: the provider itself credited this order (a 'converted' RecoveryEvent,
 *           imported from Zoko's flow export by script/import-zoko-export.ts).
 * 3. delivery: the provider reported a recovery message delivered/read to the order's phone
 *           in the ATTRIBUTION_DAYS before the order (live webhook events; includes the
 *           provider's own follow-up messages). Only phones Onymous messaged count, so the
 *           store's other broadcasts on the same account are not credited.
 * 4. cart:  only for shops with no provider events at all (e.g. no status webhook yet): a
 *           message Onymous sent to the order's phone in the window, from the cart rows.
 */
export async function findAttribution(db: Db, shop: string, o: ShopifyOrder): Promise<Attribution | null> {
  const cartId = recoveryCartId(o);
  if (cartId) {
    const cart = await db.abandonedCart.findFirst({ where: { id: cartId, shop }, select: { id: true } });
    return { via: "link", table: "cart", id: cart?.id ?? null, source: "tag" };
  }

  const converted = await db.recoveryEvent.findFirst({
    where: { shop, event: "converted", orderId: { in: [String(o.id), o.name ?? ""].filter(Boolean) } },
    select: { id: true },
  });
  if (converted) return { via: "message", table: null, id: null, clicked: false, source: "conversion" };

  const keys = orderPhoneKeys(o);
  if (!keys.length) return null;
  const orderAt = new Date(o.created_at);
  const from = new Date(orderAt.getTime() - ATTRIBUTION_DAYS * 86_400_000);

  const delivered = await db.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS n FROM stores."RecoveryEvent" e
    WHERE e.shop = ${shop} AND e.origin = 'webhook' AND e.event IN ('delivered', 'read')
      AND e."phoneKey" = ANY(${keys}::text[]) AND e.at >= ${from} AND e.at <= ${orderAt}
      AND EXISTS (
        SELECT 1 FROM stores."AbandonedCart" c
        WHERE c.shop = ${shop} AND c."abandonedSentAt" IS NOT NULL
          AND right(regexp_replace(c.phone, '\\D', '', 'g'), 9) = e."phoneKey"
        UNION ALL
        SELECT 1 FROM stores."ProductView" v
        WHERE v.shop = ${shop} AND v."abandonedSentAt" IS NOT NULL
          AND right(regexp_replace(v.phone, '\\D', '', 'g'), 9) = e."phoneKey"
      )`;
  if (delivered[0]?.n) return { via: "message", table: null, id: null, clicked: false, source: "delivery" };

  // Provider events exist for this shop: they are the source of truth, no guessing from carts
  const hasEvents = await db.recoveryEvent.findFirst({ where: { shop }, select: { id: true } });
  if (hasEvents) return null;
  // A row can be messaged twice (abandonedSentAt, then lastAbandonedSentAt); take the
  // latest message sent before the order.
  const rows = await db.$queryRaw<{ table: "cart" | "browse"; id: string; clicked: boolean }[]>`
    WITH r AS (
      SELECT 'cart' AS "table", id, phone, "abandonedSentAt" AS a, "lastAbandonedSentAt" AS b, "recoveryClickedAt" AS c
      FROM stores."AbandonedCart" WHERE shop = ${shop}
      UNION ALL
      SELECT 'browse', id, phone, "abandonedSentAt", "lastAbandonedSentAt", "recoveryClickedAt"
      FROM stores."ProductView" WHERE shop = ${shop}
    ), m AS (
      SELECT "table", id, c,
             CASE WHEN b IS NOT NULL AND b <= ${orderAt} THEN b ELSE a END AS sent_at
      FROM r
      WHERE right(regexp_replace(phone, '\\D', '', 'g'), 9) = ANY(${keys}::text[])
    )
    SELECT "table", id, (c IS NOT NULL AND c >= sent_at AND c <= ${orderAt}) AS clicked
    FROM m
    WHERE sent_at >= ${from} AND sent_at <= ${orderAt}
    ORDER BY sent_at DESC
    LIMIT 1`;
  const r = rows[0];
  return r ? { via: "message", table: r.table, id: r.id, clicked: r.clicked, source: "cart" } : null;
}

const CLEAR_CART_PURCHASE = {
  isPurchased: false, purchasedAt: null, purchaseAttribution: null, purchaseOrderId: null,
  purchaseTotal: null, purchaseCurrency: null, purchaseGateway: null,
} as const;

/** Undo the purchase this order recorded on a cart / product view (cancelled or no longer attributed). */
async function clearPurchaseMarks(tx: Prisma.TransactionClient, shop: string, orderNumericId: string, orderAt: Date) {
  await tx.abandonedCart.updateMany({
    where: { shop, purchaseOrderId: orderNumericId },
    data: CLEAR_CART_PURCHASE,
  });
  // ProductView has no order id; the sync set purchasedAt to the order's own time
  await tx.productView.updateMany({
    where: { shop, isPurchased: true, purchasedAt: orderAt },
    data: { isPurchased: false, purchasedAt: null },
  });
}

/**
 * Creates, updates or removes the Order row for one Shopify order, with its attribution
 * (findAttribution: 'link' | 'message' | null). Safe to call repeatedly and concurrently
 * for the same order (webhook retries, create and updated arriving together, a backfill
 * running alongside the webhook).
 */
export async function syncShopifyOrder(store: OrderStore, o: ShopifyOrder): Promise<SyncResult> {
  if (!o?.id || !o.created_at) return "skipped";
  const shopifyOrderId = orderGid(o);
  const orderNumericId = String(o.id);
  const orderAt = new Date(o.created_at);

  return prisma.$transaction(async (tx) => {
    // Order has no unique key on shopifyOrderId; serialise writers per order instead.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${store.id}:${shopifyOrderId}`}))`;
    const existing = await tx.order.findMany({
      where: { storeId: store.id, shopifyOrderId },
      select: { id: true, attribution: true },
      orderBy: { createdAt: "asc" },
    });

    // Cancelled and test orders are not sales: removed, and they stop counting for their cart
    if (notASale(o)) {
      if (o.cancelled_at || existing.some((e) => e.attribution)) {
        await clearPurchaseMarks(tx, store.shopDomain, orderNumericId, orderAt);
      }
      if (!existing.length) return "skipped";
      await tx.order.deleteMany({ where: { id: { in: existing.map((e) => e.id) } } });
      return "removed";
    }

    const match = await findAttribution(tx, store.shopDomain, o);
    // No longer attributed (e.g. the window was shortened): undo the cart close it made
    if (!match && existing.some((e) => e.attribution)) {
      await clearPurchaseMarks(tx, store.shopDomain, orderNumericId, orderAt);
    }

    const data = { ...toRow(store, o), attribution: match?.via ?? null };
    const purchase = {
      isPurchased: true,
      purchasedAt: data.createdAt,
      purchaseOrderId: orderNumericId,
      purchaseTotal: data.paidTotal,
      purchaseCurrency: data.currency,
      purchaseGateway: data.paymentMethod,
    };

    if (!match) {
      // not attributed: saved for store totals only
    } else if (match.via === "link") {
      // The order names this exact cart, so it is a recovery whatever was recorded before
      // (the storefront may have closed it as assisted/influenced without an order id).
      if (match.id) await tx.abandonedCart.updateMany({
        where: {
          id: match.id,
          NOT: { isPurchased: true, purchaseAttribution: "recovered", purchaseOrderId: orderNumericId },
        },
        data: { ...purchase, purchaseAttribution: "recovered" },
      });
    } else if (match.table === "cart" && match.id) {
      // Bought after the message without the link (onymous-app's labels): clicked earlier =
      // assisted, never clicked = influenced. Never overwrite an earlier close.
      await tx.abandonedCart.updateMany({
        where: { id: match.id, isPurchased: false },
        data: { ...purchase, purchaseAttribution: match.clicked ? "assisted" : "influenced" },
      });
    } else if (match.table === "browse" && match.id) {
      await tx.productView.updateMany({
        where: { id: match.id, isPurchased: false },
        data: { isPurchased: true, purchasedAt: data.createdAt },
      });
    }

    if (!existing.length) {
      await tx.order.create({ data: { id: crypto.randomUUID(), ...data } }); // Order.id has no DB default here
      return "created";
    }
    await tx.order.update({ where: { id: existing[0]!.id }, data });
    if (existing.length > 1) {
      await tx.order.deleteMany({ where: { id: { in: existing.slice(1).map((e) => e.id) } } });
    }
    return "updated";
  });
}

/** Registers the order webhook topics for a shop (skips ones already pointing at us). */
export async function registerOrderWebhooks(shopDomain: string, accessToken: string, baseUrl: string) {
  const address = `${baseUrl.replace(/\/$/, "")}${ORDER_WEBHOOK_PATH}`;
  const api = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/webhooks.json`;
  const headers = { "X-Shopify-Access-Token": accessToken, "Content-Type": "application/json" };

  const res = await fetch(api, { headers });
  if (!res.ok) throw new Error(`list webhooks: ${res.status} ${await res.text()}`);
  const { webhooks = [] } = (await res.json()) as { webhooks?: { topic: string; address: string }[] };
  const have = new Set(webhooks.filter((w) => w.address === address).map((w) => w.topic));

  const added: string[] = [];
  const failed: string[] = [];
  for (const topic of ORDER_WEBHOOK_TOPICS) {
    if (have.has(topic)) continue;
    const r = await fetch(api, {
      method: "POST",
      headers,
      body: JSON.stringify({ webhook: { topic, address, format: "json" } }),
    });
    if (r.ok) added.push(topic);
    else failed.push(`${topic}: ${r.status} ${await r.text()}`);
  }
  return { address, added, existing: [...have], failed };
}
