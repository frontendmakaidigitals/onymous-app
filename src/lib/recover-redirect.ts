// Short recovery link: https://useonymous.com/r/<abandonedCartId>
// Records the click, then 302s straight to the stored Shopify cart permalink
// (no storefront homepage, no theme JS, no CORS preflight).
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { prisma } from "@/lib/prisma";
import {
  buildRecoveryLink,
  markRecoveryClicked,
  nativeCheckoutPath,
  normalizeItems,
  recoveryContext,
} from "@/lib/abandoned-cart";

// Link-preview fetchers and scanners must not count as customer clicks
const BOT_RE = /bot|crawler|spider|preview|facebookexternalhit|whatsapp|slurp|headless|curl|wget/i;

// reply.code(302).header("Location") works on Fastify 4 and 5 (the redirect() signature differs)
function go(reply: FastifyReply, url: string) {
  return reply.code(302).header("Location", url).header("Cache-Control", "no-store").send();
}

const recoverRedirectRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const { id } = req.params;
    if (!id || id.length > 64) return reply.code(404).send("Not found");

    const row = await prisma.abandonedCart.findUnique({
      where: { id },
      select: {
        shop: true,
        isPurchased: true,
        checkoutPath: true,
        items: true,
        email: true,
        name: true,
        phone: true,
      },
    });
    if (!row) return reply.code(404).send("Not found");

    const { base, overlay } = await recoveryContext(row.shop);

    // Overlay stores: the storefront snippet opens the GulfCart overlay and records the click
    if (overlay) return go(reply, buildRecoveryLink(base, id));

    // Already bought, or cart emptied: nothing to recover, drop them on the store
    const items = normalizeItems(row.items);
    if (row.isPurchased || !items.length) return go(reply, base);

    // Don't let WhatsApp previews / scanners register as clicks
    const ua = req.headers["user-agent"] ?? "";
    if (!BOT_RE.test(ua)) {
      markRecoveryClicked(id).catch((err) => req.log.error({ err }, "recover click write failed"));
    }

    // Rows created before checkoutPath existed: build the permalink on the fly
    const target =
      row.checkoutPath ??
      base + nativeCheckoutPath({ id, items, email: row.email, name: row.name, phone: row.phone });

    return go(reply, target);
  });
};

export default recoverRedirectRoutes;