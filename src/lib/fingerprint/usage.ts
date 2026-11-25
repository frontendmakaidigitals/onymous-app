// Fingerprint Pro is billed per identification (each agent.get() in the browser).
// Per store: Store.fingerprintEnabled turns it off, Store.fingerprintMonthlyLimit caps it per
// calendar month (UTC, like Fingerprint's billing). FingerprintUsage is the meter the dashboard shows.
//
//   fingerprintAllowed(shop)   popup bootstrap: should the browser identify at all?
//   chargeFingerprint(shop)    server, once per requestId: count it, and say whether to use it
import { prisma } from "@/lib/prisma";

export const usageMonth = (d = new Date()) => d.toISOString().slice(0, 7);

type Gate = { storeId: string; enabled: boolean; limit: number | null };

async function gate(shop: string | null | undefined): Promise<Gate | null> {
  if (!shop) return null;
  const s = await prisma.store.findUnique({
    where: { shopDomain: shop.toLowerCase() },
    select: { id: true, fingerprintEnabled: true, fingerprintMonthlyLimit: true },
  });
  return s ? { storeId: s.id, enabled: s.fingerprintEnabled, limit: s.fingerprintMonthlyLimit } : null;
}

async function used(storeId: string) {
  const row = await prisma.fingerprintUsage.findUnique({
    where: { storeId_month: { storeId, month: usageMonth() } },
    select: { count: true },
  });
  return row?.count ?? 0;
}

/** Browser may call Fingerprint for this shop: enabled and under this month's limit. */
export async function fingerprintAllowed(shop: string | null | undefined): Promise<boolean> {
  const g = await gate(shop);
  if (!g?.enabled) return false;
  return g.limit == null || (await used(g.storeId)) < g.limit;
}

/**
 * A browser identified (it sent a fresh requestId): that call is already billed, so it is always
 * counted. Returns whether to use it: false when the store has fingerprinting off or the call
 * went over the monthly limit (a page loaded before the limit was hit).
 */
export async function chargeFingerprint(shop: string | null | undefined): Promise<boolean> {
  const g = await gate(shop);
  if (!g) return false; // unknown shop: nothing to bill it to, and nothing to recognise against
  const month = usageMonth();
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "stores"."FingerprintUsage" ("storeId", "month", "count", "updatedAt")
    VALUES (${g.storeId}, ${month}, 1, now())
    ON CONFLICT ("storeId", "month") DO UPDATE
      SET "count" = "FingerprintUsage"."count" + 1, "updatedAt" = now()
    RETURNING "count"`;
  const count = rows[0]?.count ?? 0;
  return g.enabled && (g.limit == null || count <= g.limit);
}
