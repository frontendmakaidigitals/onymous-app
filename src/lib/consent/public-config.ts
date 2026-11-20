// What the storefront may know about a shop's consent popup. Served to anonymous
// shoppers, so never add store secrets here.
import { config as appConfig } from "@/config";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_TEMPLATE,
  liveTemplate,
  pickPrimary,
  pickTextColor,
  resolveContent,
  withLogo,
  type PopupContent,
  type PopupTemplateKey,
} from "./templates";

export type PublicPopupConfig = {
  enabled: boolean;
  templateKey: PopupTemplateKey;
  content: PopupContent;
  primaryColor: string;
};

export type PopupStore = { id: string; name: string; shopDomain: string | null; websiteUrl: string | null };

/** Store-level branding set in the dashboard (Consent popup / Profile > Branding). */
export type PopupBrand = { primaryColor: string; textColor: string | null; logoUrl: string | null };

const SHOP_RE = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)*\.myshopify\.com$/i;

/**
 * Logos uploaded in the dashboard are saved as "/uploads/store-logos/…" and served by the
 * dashboard, so make them absolute. Anything else must already be https.
 */
function logoUrl(logo: string | null): string | null {
  if (!logo) return null;
  if (/^https:\/\/[^\s"'<>]+$/i.test(logo)) return logo;
  if (logo.startsWith("/uploads/") && !logo.includes("..")) {
    try {
      return new URL(logo, appConfig.DASHBOARD_URL).toString();
    } catch {
      return null;
    }
  }
  return null;
}

export async function getPublicPopupConfig(
  shop: string | null | undefined,
): Promise<{ store: PopupStore; brand: PopupBrand; config: PublicPopupConfig | null } | null> {
  if (!shop || !SHOP_RE.test(shop)) return null;

  const row = await prisma.store.findUnique({
    where: { shopDomain: shop.toLowerCase() },
    select: {
      id: true,
      name: true,
      shopDomain: true,
      websiteUrl: true,
      logo: true,
      primaryColor: true,
      textColor: true,
    },
  });
  if (!row) return null;
  const { logo, primaryColor: storeColor, textColor, ...store } = row;

  const brand: PopupBrand = {
    primaryColor: pickPrimary(null, storeColor),
    textColor: pickTextColor(textColor),
    logoUrl: logoUrl(logo),
  };

  const popup = await prisma.consentPopupConfig.findUnique({ where: { storeId: store.id } });
  let config: PublicPopupConfig | null = null;
  if (popup) {
    const templateKey = liveTemplate(popup.templateKey); // retired templates show as the default
    config = {
      enabled: popup.enabled,
      templateKey,
      content: withLogo(resolveContent(popup.content, store.name), templateKey, brand.logoUrl),
      primaryColor: pickPrimary(popup.primaryColor, storeColor),
    };
  }

  return { store, brand, config };
}

/** Content for a store with no saved popup yet: defaults + its branding. */
export const fallbackContent = (store: PopupStore, brand: PopupBrand, key: PopupTemplateKey = DEFAULT_TEMPLATE) =>
  withLogo(resolveContent(null, store.name), key, brand.logoUrl);
