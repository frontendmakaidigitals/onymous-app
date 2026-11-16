import { prisma } from "@/lib/prisma";
import { verifyCartToken } from "@/lib/cart-token";
import { isStoreOrigin } from "@/lib/store-origin";

/**
 * Shared auth for storefront -> checkout tracking calls (cart sync, PDP views).
 * token  -> HMAC cart token (customer, shop, TrustedDevice.id)
 * origin -> must be one of the token shop's storefront origins
 * device -> must still be trusted (not revoked)
 * phone  -> read from DB, never from the request
 */

export function cors(origin: string | null | undefined) {
  return {
    "Access-Control-Allow-Origin": origin ?? "",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/**
 * Preflight: allow only origins that belong to some store.
 * Usage in a route:
 *   const { status, headers } = await preflight(req.headers.origin);
 *   return reply.headers(headers).code(status).send();
 */
export async function preflight(
  origin: string | null | undefined,
): Promise<{ status: number; headers: Record<string, string> }> {
  const denied = { status: 403, headers: {} };
  if (!origin) return denied;

  let host = "";
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {}
  if (!host) return denied;

  const bare = host.replace(/^www\./, "");
  const match = await prisma.store.findFirst({
    where: {
      OR: [
        { shopDomain: host },
        { websiteUrl: { contains: bare, mode: "insensitive" } },
      ],
    },
    select: { id: true },
  });
  if (!match) return denied;

  return { status: 204, headers: cors(origin) };
}

export type StorefrontIdentity = {
  shop: string;
  store: { id: string; shopDomain: string | null; websiteUrl: string | null };
  customer: {
    id: string;
    phone: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
  };
  device: { id: string; fpVisitorId: string | null };
};

export async function authenticateStorefront(
  origin: string | null | undefined,
  token: unknown,
): Promise<{ ok: true; id: StorefrontIdentity } | { ok: false; status: number }> {
  const claim = verifyCartToken(token);
  if (!claim) return { ok: false, status: 401 };

  const store = await prisma.store.findUnique({
    where: { shopDomain: claim.s },
    select: { id: true, shopDomain: true, websiteUrl: true },
  });
  if (!store || !isStoreOrigin(origin, store)) return { ok: false, status: 403 };

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
  const device = customer?.TrustedDevice[0];
  if (!customer?.phone || !device) {
    return { ok: false, status: 401 };
  }

  return {
    ok: true,
    id: {
      shop: claim.s,
      store,
      customer: {
        id: customer.id,
        phone: customer.phone,
        email: customer.email,
        firstName: customer.firstName,
        lastName: customer.lastName,
      },
      device,
    },
  };
}
