import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "crypto";
import redis from "@/lib/redis";
import { prisma } from "@/lib/prisma";
import { sendOtpMessage, testOtpFor } from "@/lib/sms";
import { OTP_LENGTH } from "@/lib/otp-code";

const OTP_TTL_S = 5 * 60;
const RESEND_COOLDOWN_S = 60;
const MAX_ATTEMPTS = 5;
const MAX_SENDS_PER_HOUR = 5;

const key = (shop: string, phone: string) => `gc:otp:${shop}:${phone}`;
/** Audit trail in stores."OtpEvent" (same table checkout-app writes). Never blocks the flow. */
async function logOtpEvent(phone: string, status: "SENT" | "FAILED" | "VERIFIED", reason?: string) {
  try {
    await prisma.otpEvent.create({ data: { id: randomUUID(), phone, status, reason: reason ?? null } });
  } catch (err) {
    console.error("[otp] failed to log event:", err);
  }
}

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

  const testCode = testOtpFor(phone);
  const code = testCode ?? randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, "0");
  const salt = randomBytes(8).toString("hex");
  await redis
    .multi()
    .hset(key(shop, phone), { h: hash(code, salt), s: salt, a: 0 })
    .expire(key(shop, phone), OTP_TTL_S)
    .exec();

  if (testCode) {
    await logOtpEvent(phone, "SENT", "test_number");
    return { ok: true, expiresIn: OTP_TTL_S };
  }

  try {
    await sendOtpMessage(phone, code);
  } catch (err) {
    await redis.del(key(shop, phone), cooldownKey);
    await logOtpEvent(phone, "FAILED", err instanceof Error ? err.message.slice(0, 500) : "send_error");
    throw err;
  }
  await logOtpEvent(phone, "SENT");
  return { ok: true, expiresIn: OTP_TTL_S };
}

export type VerifyResult = "ok" | "invalid" | "expired" | "locked";

export async function verifyOtp(shop: string, phone: string, code: string): Promise<VerifyResult> {
  const k = key(shop, phone);
  const rec = await redis.hgetall(k);
  if (!rec.h || !rec.s) {
    await logOtpEvent(phone, "FAILED", "expired_or_missing");
    return "expired";
  }

  const attempts = await redis.hincrby(k, "a", 1);
  if (attempts > MAX_ATTEMPTS) {
    await redis.del(k); // burn the code: a new one must be requested
    await logOtpEvent(phone, "FAILED", "too_many_attempts");
    return "locked";
  }

  const given = Buffer.from(hash(code, rec.s), "hex");
  const stored = Buffer.from(rec.h, "hex");
  if (given.length !== stored.length || !timingSafeEqual(given, stored)) {
    await logOtpEvent(phone, "FAILED", "mismatch");
    return "invalid";
  }

  await redis.del(k); // single use
  await logOtpEvent(phone, "VERIFIED");
  return "ok";
}
