// gc_recover link -> what the storefront should do with it.
//   mode "gulfcart": GulfCart checkout is live -> checkout snippet opens the overlay with `items`
//   mode "native":   GulfPass only / native checkout -> snippet redirects to `permalinkPath`
// Items are re-hydrated from Shopify so either path gets live price, compare-at, stock.
// Records the click (recoveryClickedAt) — the reason links land on a store page first.
import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import {
  itemsTotal,
  markRecoveryClicked,
  nativeCheckoutPath,
  normalizeItems,
  type RecoveryItem,
} from "@/lib/abandoned-cart";

// Match the Admin API version used elsewhere in the checkout app.
const SHOPIFY_API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION ?? "2026-04";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  // ngrok-skip-browser-warning: sent by the snippets so ngrok (local dev) returns
  // JSON instead of its browser warning page. Harmless on staging/prod.
  "Access-Control-Allow-Headers": "Content-Type, ngrok-skip-browser-warning",
  "Cache-Control": "no-store",
};

const VARIANTS_QUERY = `
  query RecoverVariants($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        title
        price
        compareAtPrice
        sku
        availableForSale
        image { url }
        product {
          id
          title
          handle
          featuredMedia { preview { image { url } } }
          collections(first: 50) { nodes { id } }
        }
      }
    }
  }
`;

function gidNum(gid: string | null | undefined): number | null {
  const n = Number(String(gid ?? "").split("/").pop());
  return Number.isFinite(n) && n > 0 ? n : null;
}

type VariantNode = {
  id: string;
  title: string;
  price: string;
  compareAtPrice: string | null;
  sku: string | null;
  availableForSale: boolean;
  image: { url: string } | null;
  product: {
    id: string;
    title: string;
    handle: string;
    featuredMedia: { preview: { image: { url: string } | null } | null } | null;
    collections: { nodes: { id: string }[] };
  };
} | null;

/**
 * Live Shopify data for the stored lines. Drops deleted / unavailable variants.
 * Returns null if Shopify can't be reached, so the caller can fall back to the snapshot.
 */
async function hydrate(
  shop: string,
  accessToken: string,
  items: RecoveryItem[],
): Promise<RecoveryItem[] | null> {
  try {
    const res = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({
        query: VARIANTS_QUERY,
        variables: { ids: items.map((i) => `gid://shopify/ProductVariant/${i.variant_id}`) },
      }),
    });
    if (!res.ok) {
      console.warn(`[cart/recover] hydrate HTTP ${res.status} for ${shop}`);
      return null;
    }
    const json: any = await res.json();
    if (json.errors) {
      console.warn("[cart/recover] hydrate errors:", JSON.stringify(json.errors));
      return null;
    }

    const nodes: VariantNode[] = json?.data?.nodes ?? [];
    const out: RecoveryItem[] = [];

    items.forEach((item, idx) => {
      const v = nodes[idx];
      if (!v || !v.availableForSale) return;

      const price = Number(v.price);
      const compareAt = v.compareAtPrice != null ? Number(v.compareAtPrice) : null;

      out.push({
        product_title: v.product.title,
        variant_title: v.title === "Default Title" ? null : v.title,
        quantity: item.quantity,
        original_price: price,
        ...(compareAt !== null && compareAt > price ? { compare_at_price: compareAt } : {}),
        image: v.image?.url ?? v.product.featuredMedia?.preview?.image?.url ?? item.image,
        variant_id: String(gidNum(v.id) ?? item.variant_id),
        product_id: gidNum(v.product.id),
        collection_ids: v.product.collections.nodes
          .map((c) => gidNum(c.id))
          .filter((n): n is number => n !== null),
        sku: v.sku,
        handle: v.product.handle,
      });
    });

    return out;
  } catch (err) {
    console.warn("[cart/recover] hydrate failed:", err);
    return null;
  }
}

const recoverRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", async (_req, reply) => {
    reply.headers(CORS_HEADERS);
  });

  app.options("/", async (_req, reply) => reply.code(204).send());

  app.get("/", async (req, reply) => {
    const { token } = req.query as { token?: string };
    if (!token) {
      return reply.code(400).send({ error: "Missing token" });
    }

    const cart = await prisma.abandonedCart.findUnique({ where: { id: token } });
    if (!cart || cart.isPurchased) {
      return reply.code(404).send({ error: "Cart not found" });
    }
    await markRecoveryClicked(cart.id);

    const stored = normalizeItems(cart.items);
    if (!stored.length) {
      return reply.code(404).send({ error: "Cart not found" });
    }

    const store = await prisma.store.findUnique({
      where: { shopDomain: cart.shop },
      select: { currency: true, oauthToken: true, isActive: true },
    });

    let accessToken: string | null = null;
    if (store?.oauthToken) {
      try {
        accessToken = (await decrypt(store.oauthToken)) || null;
      } catch (err) {
        console.warn("[cart/recover] token decrypt failed:", err);
      }
    }

    let items = stored;
    let currency = cart.currency;

    if (store && accessToken) {
      const live = await hydrate(cart.shop, accessToken, stored);
      if (live) {
        items = live;
        currency = store.currency; // Admin API prices are in the shop's base currency
      }
    }

    if (!items.length) {
      return reply.code(410).send({ error: "Items no longer available" });
    }

    await markRecoveryClicked(cart.id);

    // isActive = GulfCart checkout live on this store. Anything else recovers via native checkout.
    const mode = store?.isActive ? "gulfcart" : "native";

    return {
      mode,
      items,
      currency,
      total: itemsTotal(items),
      shop: cart.shop,
      customer: {
        name: cart.name || "",
        email: cart.email || "",
        phone: cart.phone || "",
      },
      // Always sent, also in "gulfcart" mode: the header snippet only redirects here when
      // the GulfCart checkout snippet isn't on the page (window.__gcCheckoutLoaded), so a
      // store marked isActive without the overlay installed still reaches native checkout.
      permalinkPath: nativeCheckoutPath({
        id: cart.id,
        items,
        email: cart.email,
        name: cart.name,
        phone: cart.phone,
      }),
    };
  });
};

export default recoverRoutes;
