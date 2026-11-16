// What the storefront may know about a shop's consent popup. Served to anonymous
// shoppers, so never add store secrets here.
import { prisma } from "@/lib/prisma";
import { DEFAULT_PRIMARY, HEX_RE, isTemplateKey, resolveContent, type PopupContent, type PopupTemplateKey } from "./templates";

export type PublicPopupConfig = {
  enabled: boolean;
  templateKey: PopupTemplateKey;
  content: PopupContent;
  primaryColor: string;
};

export type PopupStore = { id: string; shopDomain: string | null; websiteUrl: string | null };

const SHOP_RE = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)*\.myshopify\.com$/i;

export async function getPublicPopupConfig(
  shop: string | null | undefined,
): Promise<{ store: PopupStore; config: PublicPopupConfig | null } | null> {
  if (!shop || !SHOP_RE.test(shop)) return null;

  const store = await prisma.store.findUnique({
    where: { shopDomain: shop.toLowerCase() },
    select: { id: true, name: true, shopDomain: true, websiteUrl: true },
  });
  if (!store) return null;

  const row = await prisma.consentPopupConfig.findUnique({ where: { storeId: store.id } });
  const config =
    row && isTemplateKey(row.templateKey)
      ? {
          enabled: row.enabled,
          templateKey: row.templateKey,
          content: resolveContent(row.content, store.name),
          primaryColor: row.primaryColor && HEX_RE.test(row.primaryColor) ? row.primaryColor : DEFAULT_PRIMARY,
        }
      : null;

  return { store: { id: store.id, shopDomain: store.shopDomain, websiteUrl: store.websiteUrl }, config };
}
