import type { FastifyPluginAsync } from "fastify";
import redis from "@/lib/redis";
import { prisma } from "@/lib/prisma";
import { signCartToken } from "@/lib/cart-token";
import { isStoreOrigin } from "@/lib/store-origin";


const cartTokenRoutes: FastifyPluginAsync = async (app) => {
  app.post("/", async (req, reply) => {
    const auth = req.headers.authorization || "";
    const sessionToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!sessionToken) return reply.code(401).send({ cartToken: null });

    const raw = await redis.get(`gc:idsess:${sessionToken}`);
    if (!raw) return reply.code(401).send({ cartToken: null });

    let sess: { customerId?: string; shop?: string; deviceId?: string | null };
    try {
      sess = JSON.parse(raw);
    } catch {
      return reply.code(401).send({ cartToken: null });
    }
    if (!sess.customerId || !sess.shop || !sess.deviceId) {
      return reply.code(401).send({ cartToken: null });
    }

    const { parentOrigin } = (req.body ?? {}) as { parentOrigin?: string };

    const store = await prisma.store.findUnique({
      where: { shopDomain: sess.shop },
      select: { shopDomain: true, websiteUrl: true },
    });
    if (!store || !isStoreOrigin(parentOrigin, store)) {
      req.log.info({ shop: sess.shop, parentOrigin }, "[cart-token] origin rejected");
      return reply.code(403).send({ cartToken: null });
    }

    const cartToken = signCartToken({
      c: sess.customerId,
      s: sess.shop,
      d: sess.deviceId,
    });

    return reply.header("Cache-Control", "no-store").send({ cartToken });
  });
};

export default cartTokenRoutes;
