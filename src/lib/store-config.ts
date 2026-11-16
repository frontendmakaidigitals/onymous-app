import { prisma } from "./prisma";
import { decrypt } from "./crypto";


type CodCountryFee = {
  feeType: "fixed" | "percentage";
  feeValue: number;
  minOrderValue?: number;
  maxOrderValue?: number;
};

const dec = (v: string | null | undefined): string | null =>
  v ? decrypt(v) : null;

const CHECKOUT_DOMAIN = (
  process.env.CHECKOUT_URL ?? "https://checkout.gulfcart.ae"
)
  .replace(/^https?:\/\//, "")
  .replace(/\/.*$/, "")
  .trim();

// Stripe's own subscription.status values that should still allow
// checkout to run: "active" (paid), "trialing" (on trial, not yet
// charged), and "past_due" (a payment attempt failed but Stripe is still
// retrying — grace period, don't cut off checkout on the first failure).
// Anything else (canceled, unpaid, incomplete, incomplete_expired,
// paused) blocks checkout.
const CHECKOUT_ALLOWED_SUBSCRIPTION_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
]);

export async function getStoreConfig(shopDomain: string) {
  const store = await prisma.store.findUnique({
    where: { shopDomain },
    include: {
      stripeApplePayDomains: {
        select: { domain: true, enabled: true, applePayStatus: true },
      },
      tabbyWebhooks: {
        select: { region: true },
      },
      merchantSubscription: {
        select: { status: true },
      },
      StoreVatRate: {
        select: {
          countryCode: true,
          countryName: true,
          percentage: true,
          taxName: true,
        },
      },
    },
  });

  if (!store) throw new Error(`No store config found for: ${shopDomain}`);


  return {
    id: store.id,
    shopDomain: store.shopDomain!,
    currency: store.currency,
    websiteUrl: store.websiteUrl,

    rtl: store.rtl,
    language: store.language,

    active: store.isActive,
    subscriptionExempt: store.subscriptionExempt,
    subscriptionActive: CHECKOUT_ALLOWED_SUBSCRIPTION_STATUSES.has(
      store.merchantSubscription?.status ?? "",
    ),

    accessToken: dec(store.oauthToken),
    clientId: dec(store.shopifyClientId),
    clientSecret: dec(store.shopifyClientSecret),

    logo: store.logo,
    primaryColor: store.primaryColor,
    textColor: store.textColor,
    pixelId: store.pixelId,


  };
}

export type StoreConfig = Awaited<ReturnType<typeof getStoreConfig>>;

export type PublicStoreConfig = {
  shopDomain: string;
  currency: string;
  websiteUrl: string | null;

  rtl: boolean;
  language: string | null;


  logo: string | null;
  primaryColor: string | null;
  textColor: string | null;
  pixelId: string;

};

export function PublicStoreConfig(config: StoreConfig): PublicStoreConfig {
  return {
    shopDomain: config.shopDomain,
    currency: config.currency,
    websiteUrl: config.websiteUrl,

    rtl: config.rtl,
    language: config.language,


    logo: config.logo,
    primaryColor: config.primaryColor,
    textColor: config.textColor,
    pixelId: config.pixelId,

  };
}