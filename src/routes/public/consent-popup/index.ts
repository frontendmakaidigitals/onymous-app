// GET /api/public/consent-popup?shop=<shop>.myshopify.com
// Called by the storefront loader on page views. Public, read-only, cached.
import type { FastifyPluginAsync } from "fastify";
import { getPublicPopupConfig } from "@/lib/consent/public-config";

const consentPopupRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { shop?: string } }>("/", async (req, reply) => {
    const found = await getPublicPopupConfig(req.query.shop);
    const cfg = found?.config;
    reply
      .header("Access-Control-Allow-Origin", "*")
      .header("Cache-Control", "public, max-age=60, s-maxage=60, stale-while-revalidate=300");
    return cfg ? { enabled: cfg.enabled, templateKey: cfg.templateKey } : { enabled: false };
  });
};

export default consentPopupRoutes;
