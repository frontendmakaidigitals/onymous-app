import { createHash, randomBytes, randomInt, timingSafeEqual } from "crypto";
import redis from "@/lib/redis";
import { sendSms } from "@/lib/sms";

const OTP_TTL_S = 5 * 60;
const RESEND_COOLDOWN_S = 60;
const MAX_ATTEMPTS = 5;
const MAX_SENDS_PER_HOUR = 5;

const key = (shop: string, phone: string) => `gc:otp:${shop}:${phone}`;
const hash = (code: string, salt: string) =>
  createHash("sha256").update(`${salt}:${code}`).digest("hex");

export type SendResult =
  | { ok: true; expiresIn: number }
  | { ok: false; reason: "cooldown" | "too_many"; retryAfter: number };

export async function sendOtp(shop: string, phone: string): Promise<SendResult> {
  const cooldownKey = `${key(shop, phone)}:cd`;
  const hourKey = `${key(shop, phone)}:hr`;

  const cd = await redis.set(cooldownKey, "1", "EX", RESEND_COOLDOWN_S, "NX");
  if (cd !== "OK") {
    return { ok: false, reason: "cooldown", retryAfter: Math.max(await redis.ttl(cooldownKey), 1) };
  }

  const sends = await redis.incr(hourKey);
  if (sends === 1) await redis.expire(hourKey, 3600);
  if (sends > MAX_SENDS_PER_HOUR) {
    return { ok: false, reason: "too_many", retryAfter: Math.max(await redis.ttl(hourKey), 1) };
  }

  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const salt = randomBytes(8).toString("hex");
  await redis
    .multi()
    .hset(key(shop, phone), { h: hash(code, salt), s: salt, a: 0 })
    .expire(key(shop, phone), OTP_TTL_S)
    .exec();

  try {
    await sendSms(phone, `Your verification code is ${code}. It expires in 5 minutes.`);
  } catch (err) {
    await redis.del(key(shop, phone), cooldownKey);
    throw err;
  }
  return { ok: true, expiresIn: OTP_TTL_S };
}

export type VerifyResult = "ok" | "invalid" | "expired" | "locked";

export async function verifyOtp(shop: string, phone: string, code: string): Promise<VerifyResult> {
  const k = key(shop, phone);
  const rec = await redis.hgetall(k);
  if (!rec.h || !rec.s) return "expired";

  const attempts = await redis.hincrby(k, "a", 1);
  if (attempts > MAX_ATTEMPTS) {
    await redis.del(k);
    return "locked";
  }

  const given = Buffer.from(hash(code, rec.s), "hex");
  const stored = Buffer.from(rec.h, "hex");
  if (given.length !== stored.length || !timingSafeEqual(given, stored)) return "invalid";

  await redis.del(k); // single use
  return "ok";
}
