// POST /api/webhooks/shopify/orders
//
// Shopify order webhooks -> stores."Order" (+ closes the recovered / assisted / influenced cart).
// Same handling as the dashboard's app/api/webhooks/shopify/orders route; Shopify now points here.
// Topics: orders/create, orders/updated, orders/cancelled, refunds/create.
//
// Each store is its own Shopify custom app, so the HMAC is checked with that store's
// client secret (Store.shopifyClientSecret) against the raw body.
import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { syncShopifyOrder, verifyShopifyHmac, type ShopifyOrder } from "@/lib/shopify-orders";

const ORDER_TOPICS = new Set(["orders/create", "orders/updated", "orders/paid", "orders/cancelled", "orders/edited"]);

const header = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const shopifyOrderWebhook: FastifyPluginAsync = async (app) => {
  // HMAC needs the exact bytes Shopify sent: keep JSON as a string in this plugin only
  app.addContentTypeParser("application/json", { parseAs: "string", bodyLimit: 5 * 1024 * 1024 }, (_req, body, done) => {
    done(null, body);
  });

  app.post(
    "/",
    { config: { rateLimit: { max: 1000, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const raw = typeof req.body === "string" ? req.body : "";
      const shop = header(req.headers["x-shopify-shop-domain"]);
      const topic = header(req.headers["x-shopify-topic"]);
      const hmac = header(req.headers["x-shopify-hmac-sha256"]) || null;

      const store = shop
        ? await prisma.store.findFirst({
            where: { shopDomain: shop },
            select: { id: true, shopDomain: true, currency: true, shopifyClientSecret: true },
          })
        : null;

      let secret = "";
      try {
        secret = store?.shopifyClientSecret ? decrypt(store.shopifyClientSecret) : "";
      } catch {
        req.log.error(`[shopify-orders] cannot decrypt client secret for ${shop}`);
      }
      if (!store || !verifyShopifyHmac(raw, hmac, secret)) {
        req.log.warn(`[shopify-orders] rejected ${topic || "(no topic)"} from ${shop || "(no shop)"}: ${store ? "bad HMAC" : "unknown shop"}`);
        return reply.code(401).send({ error: "Unauthorized" });
      }

      // refunds/create and anything else: acknowledge so Shopify does not retry
      if (!ORDER_TOPICS.has(topic)) return { ok: true, ignored: topic };

      let order: ShopifyOrder;
      try {
        order = JSON.parse(raw);
      } catch {
        return reply.code(400).send({ error: "Invalid JSON" });
      }

      try {
        const result = await syncShopifyOrder({ id: store.id, shopDomain: shop, currency: store.currency }, order);
        req.log.info(`[shopify-orders] ${shop} ${topic} order ${order?.id}: ${result}`);
        return { ok: true, result };
      } catch (err) {
        // 500 -> Shopify retries with backoff
        req.log.error({ err }, `[shopify-orders] ${shop} ${topic} order ${order?.id} failed`);
        return reply.code(500).send({ error: "Failed to save order" });
      }
    },
  );
};

export default shopifyOrderWebhook;
