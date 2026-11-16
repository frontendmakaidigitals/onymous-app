import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@/lib/prisma";
import { cors, preflight, authenticateStorefront } from "@/lib/storefront-auth";

/**
 * POST /api/storefront/product-view   { token, product }
 * Records a PDP view for a recognised customer (one row per shop+phone+product,
 * viewCount incremented). Used for browse-abandonment recovery.
 */

const str = (v: unknown, max: number) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
const idStr = (v: unknown) =>
  (typeof v === "number" && Number.isInteger(v)) || (typeof v === "string" && /^\d{1,20}$/.test(v))
    ? String(v)
    : null;

const productViewRoutes: FastifyPluginAsync = async (app) => {
  app.options("/", async (req, reply) => {
    const { status, headers } = await preflight(req.headers.origin);
    return reply.headers(headers).code(status).send();
  });

  app.post("/", async (req, reply) => {
    const origin = req.headers.origin ?? null;
    reply.headers(cors(origin));

    const body = (req.body ?? {}) as Record<string, any>;

    const auth = await authenticateStorefront(origin, body.token);
    if (!auth.ok) {
      return reply.code(auth.status).send({ ok: false, reason: "unauthenticated" });
    }
    const { shop, customer, device } = auth.id;

    const p = body.product ?? {};
    const productId = idStr(p.id);
    const title = str(p.title, 300);
    if (!productId || !title) {
      return reply.code(400).send({ ok: false });
    }

    const priceMinor = Number(p.price);
    const price =
      Number.isFinite(priceMinor) && priceMinor >= 0 && priceMinor < 100_000_000
        ? priceMinor / 100
        : null;

    const data = {
      customerId: customer.id,
      fpVisitorId: device.fpVisitorId,
      variantId: idStr(p.variantId),
      handle: str(p.handle, 300),
      title,
      variantTitle: str(p.variantTitle, 200),
      price,
      currency: str(p.currency, 3)?.toUpperCase() ?? null,
      image: str(p.image, 1000),
      url: str(p.url, 1000),
      lastViewedAt: new Date(),
    };

    await prisma.productView.upsert({
      where: { shop_phone_productId: { shop, phone: customer.phone, productId } },
      create: { shop, phone: customer.phone, productId, ...data },
      update: { ...data, viewCount: { increment: 1 } },
    });

    return { ok: true };
  });
};

export default productViewRoutes;
