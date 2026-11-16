import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@/lib/prisma";
import { verifyCartToken } from "@/lib/cart-token";
import { isStoreOrigin } from "@/lib/store-origin";
import { upsertAbandonedCart } from "@/lib/abandoned-cart";
import { preflight } from "@/lib/storefront-auth";

/**
 * Storefront cart sync for recognised (logged-in / fingerprint-matched) customers.
 * Body: { token, cart } where cart is Shopify's /cart.js JSON.
 *
 * Trust chain:
 *   token  -> HMAC-signed by /api/storefront/cart-token from a valid
 *             identity session (cookie / fingerprint / OTP) -> TrustedDevice.id
 *   phone  -> read from Customer in DB, never from the request
 *   origin -> must be one of this shop's storefront origins
 *
 * Writes through upsertAbandonedCart — same row, timer and message as an abandoned checkout.
 */

const MAX_ITEMS = 100;
const MAX_TOTAL_MINOR = 100_000_000; // 1,000,000.00 in major units

const cors = (origin: string | undefined) => ({
  "Access-Control-Allow-Origin": origin ?? "",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
});

async function storeForOrigin(origin: string | undefined, shop: string) {
  const store = await prisma.store.findUnique({
    where: { shopDomain: shop },
    select: { id: true, shopDomain: true, websiteUrl: true, isActive: true },
  });
  if (!store || !isStoreOrigin(origin, store)) return null;
  return store;
}

type ShopifyCartItem = {
  variant_id: number;
  product_id: number;
  quantity: number;
  title?: string;
  product_title?: string;
  variant_title?: string | null;
  price: number; // minor units
  original_price?: number; // minor units
  image?: string | null;
  handle?: string;
  sku?: string | null;
};

type ShopifyCart = {
  token?: string;
  currency?: string;
  total_price?: number; // minor units
  items?: ShopifyCartItem[];
};

const cartRoutes: FastifyPluginAsync = async (app) => {
  app.options("/", async (req, reply) => {
    const { status, headers } = await preflight(req.headers.origin);
    return reply.headers(headers).code(status).send();
  });

  app.post("/", async (req, reply) => {
    const origin = req.headers.origin;
    reply.headers(cors(origin));

    const body = (req.body ?? {}) as { token?: string; cart?: ShopifyCart };

    const claim = verifyCartToken(body.token);
    if (!claim) {
      return reply.code(401).send({ ok: false, reason: "unauthenticated" });
    }

    const store = await storeForOrigin(origin, claim.s);
    if (!store) {
      return reply.code(403).send({ ok: false });
    }

    // Phone comes from DB, never from the client
    const customer = await prisma.customer.findUnique({
      where: { id: claim.c },
      select: {
        id: true,
        phone: true,
        email: true,
        firstName: true,
        lastName: true,
        TrustedDevice: {
          where: { id: claim.d, revokedAt: null },
          select: { id: true, fpVisitorId: true },
          take: 1,
        },
      },
    });
    // Device revoked since the token was issued -> stop writing
    if (!customer?.phone || !customer.TrustedDevice.length) {
      return reply.code(401).send({ ok: false, reason: "unauthenticated" });
    }

    const cart: ShopifyCart = body.cart ?? {};
    const rawItems = Array.isArray(cart.items) ? cart.items.slice(0, MAX_ITEMS) : [];

    const totalMinor = Number(cart.total_price ?? 0);
    if (!Number.isFinite(totalMinor) || totalMinor < 0 || totalMinor > MAX_TOTAL_MINOR) {
      return reply.code(400).send({ ok: false });
    }

    // Minor -> major, mapped onto the checkout payload shape
    const items = rawItems.map((i) => ({
      product_title: i.product_title ?? i.title,
      variant_title: i.variant_title ?? null,
      quantity: i.quantity,
      original_price: Number(i.original_price ?? i.price) / 100,
      image: i.image ?? null,
      variant_id: i.variant_id,
      product_id: i.product_id,
      sku: i.sku ?? null,
      handle: i.handle ?? null,
    }));

    const name = [customer.firstName, customer.lastName].filter(Boolean).join(" ") || null;

    const result = await upsertAbandonedCart({
      shop: claim.s,
      phone: customer.phone,
      source: "cart",
      items,
      currency: String(cart.currency ?? "AED"),
      total: totalMinor / 100,
      cartToken: cart.token ?? null,
      customerId: customer.id,
      email: customer.email,
      name,
      fpVisitorId: customer.TrustedDevice[0]?.fpVisitorId ?? null,
    });

    return result ? { ok: true } : { ok: true, empty: true };
  });
};

export default cartRoutes;
