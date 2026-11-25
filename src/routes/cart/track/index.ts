// DEPRECATED: only used by the old gulfcart-cart-track snippet. The header snippet's
// silent fingerprint probe + /api/storefront/cart now covers the same visitors.
// Kept (writing through the shared upsert) so stores still running the old snippet
// don't break during rollout. Delete once no theme renders gulfcart-cart-track.
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { randomBytes } from "crypto";
import redis from "@/lib/redis";
import { prisma } from "@/lib/prisma";
import { byFingerprint } from "@/lib/fingerprint/recognize";
import { upsertAbandonedCart } from "@/lib/abandoned-cart";

const TRACK_TTL = 60 * 60 * 24; // 24h
const MAX_ITEMS = 100;

function cors(req: FastifyRequest, reply: FastifyReply) {
  return reply.headers({
    "Access-Control-Allow-Origin": req.headers.origin ?? "",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  });
}

async function isKnownShop(shop: string) {
  const s = await prisma.store.findUnique({
    where: { shopDomain: shop },
    select: { isActive: true },
  });
  return !!s?.isActive;
}

const trackRoutes: FastifyPluginAsync = async (app) => {
  app.options("/", async (req, reply) => cors(req, reply).code(204).send());

  app.post("/", async (req, reply) => {
    cors(req, reply);
    const { shop, fpRequestId, items, currency, total, cartToken } = (req.body ?? {}) as Record<string, any>;

    if (!shop || !(await isKnownShop(shop))) {
      return { tracked: false };
    }

    let phone: string | null = null;
    let customerId: string | null = null;
    let token = req.headers.authorization?.replace("Bearer ", "") ?? null;

    // 1) Existing tracking token (cheap path, no Fingerprint call)
    if (token) {
      const raw = await redis.get(`gc:carttrk:${token}`);
      const s = raw ? JSON.parse(raw) : null;
      if (s?.shop === shop) {
        phone = s.phone;
        customerId = s.customerId ?? null;
      }
    }

    // 2) Otherwise verify the fingerprint (requestId is single-use)
    if (!phone && fpRequestId) {
      const match = await byFingerprint(fpRequestId, shop);
      if (match) {
        phone = match.phone;
        customerId = match.customerId;
        token = randomBytes(32).toString("base64url");
        await redis.set(
          `gc:carttrk:${token}`,
          JSON.stringify({ phone, shop, customerId }),
          "EX",
          TRACK_TTL,
        );
      }
    }

    if (!phone) {
      const stale = !fpRequestId && !!req.headers.authorization;
      return reply.code(stale ? 401 : 200).send({ tracked: false });
    }

    if (Array.isArray(items) && items.length > MAX_ITEMS) {
      return reply.code(400).send({ tracked: false, token });
    }

    const result = await upsertAbandonedCart({
      shop,
      phone,
      source: "cart",
      items, // already major units in this snippet's payload
      currency: currency || "AED",
      total: typeof total === "number" ? total : null,
      cartToken: cartToken || null,
      customerId,
    });

    return { tracked: !!result, token };
  });
};

export default trackRoutes;
