import crypto from "crypto";

/**
 * Short-lived, HMAC-signed token handed to the storefront after the customer
 * is recognised (cookie / fingerprint / OTP). It only authorises writing the
 * abandoned-cart row for (customer, shop). Phone is never in the token.
 */

const SECRET = process.env.CHECKOUT_TOKEN_SECRET || "";
export const CART_TOKEN_TTL_MS = 55 * 60 * 1000; // matches storefront AUTH_TTL

export type CartTokenPayload = {
  c: string; // Customer.id
  s: string; // shop permanent domain (xxx.myshopify.com)
  d: string; // TrustedDevice.id that was matched
  exp: number;
};

function sign(data: string) {
  if (!SECRET) throw new Error("GC_CART_TOKEN_SECRET is not set");
  return crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
}

export function signCartToken(p: Omit<CartTokenPayload, "exp">): string {
  const body = Buffer.from(
    JSON.stringify({ ...p, exp: Date.now() + CART_TOKEN_TTL_MS })
  ).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifyCartToken(token: unknown): CartTokenPayload | null {
  if (typeof token !== "string" || token.length > 2048) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  const a = Buffer.from(sig);
  const b = Buffer.from(sign(body));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof p.c !== "string" || typeof p.s !== "string" || typeof p.d !== "string") return null;
    if (typeof p.exp !== "number" || p.exp < Date.now()) return null;
    return p as CartTokenPayload;
  } catch {
    return null;
  }
}