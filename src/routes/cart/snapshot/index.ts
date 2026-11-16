import type { FastifyPluginAsync } from "fastify";
import { upsertAbandonedCart, markAbandonedCartPurchased } from "@/lib/abandoned-cart";

// Checkout phone entry -> same AbandonedCart row, timer and message as the storefront cart.
// Send-state reset is handled by upsertAbandonedCart (purchased, or past the resend cooldown),
// so re-entering checkout no longer re-triggers a message every time.
const snapshotRoutes: FastifyPluginAsync = async (app) => {
  app.post("/", async (req, reply) => {
    try {
      const { phone, shop, currency, total, items, email, name, cartToken, customerId, fpVisitorId } =
        (req.body ?? {}) as Record<string, any>;

      if (!phone || !shop || !Array.isArray(items)) {
        return reply.code(400).send({ success: false, message: "Missing required fields." });
      }

      const result = await upsertAbandonedCart({
        shop,
        phone,
        source: "checkout",
        items, // checkout-token payload, major units
        currency: currency || "AED",
        total: typeof total === "number" ? total : null,
        cartToken: cartToken ?? null,
        customerId: customerId ?? null,
        email: email || null,
        name: name || null,
        fpVisitorId: fpVisitorId ?? null,
      });

      return { success: true, id: result?.id ?? null };
    } catch (err) {
      // Best-effort — never block checkout over this.
      req.log.error({ err }, "[cart/snapshot] Failed to store cart snapshot");
      return reply.code(500).send({ success: false });
    }
  });

  // Called by CheckoutClient after a non-recovery order. Closes the row as purchased so
  // attribution (organic / influenced / assisted) and stats survive.
  // createShopifyOrder also closes it — markAbandonedCartPurchased is idempotent.
  app.delete("/", async (req, reply) => {
    try {
      const { phone, shop, email } = (req.body ?? {}) as Record<string, any>;

      if (!phone || !shop) {
        return reply.code(400).send({ success: false, message: "Missing phone or shop." });
      }

      await markAbandonedCartPurchased({ shop, phone, email: email ?? null });
      return { success: true };
    } catch (err) {
      req.log.error({ err }, "[cart/snapshot] Failed to close cart snapshot");
      return reply.code(500).send({ success: false });
    }
  });
};

export default snapshotRoutes;
