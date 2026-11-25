import type { FastifyPluginAsync } from "fastify";
import { createHash, randomBytes, randomUUID } from "crypto";
import { z } from "zod";
import { isValidPhoneNumber } from "libphonenumber-js/mobile";
import { OTP_LENGTH } from "@/lib/otp-code";
import { testOtpFor } from "@/lib/sms";
import { prisma } from "@/lib/prisma";
import { sendOtp, verifyOtp } from "@/lib/otp";
import { verifyDevice } from "@/lib/fingerprint/fingerprint";
import { DEVICE_COOKIE, issueSession } from "@/lib/fingerprint/recognize";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const phone = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, "Phone must be in E.164 format")
  // Same per-country mobile check as the popup (the code is sent by WhatsApp/SMS)
  .refine((p) => isValidPhoneNumber(p) || testOtpFor(p) !== null, "Not a valid mobile number");
const shop = z.string().trim().min(1).max(255);

const sendBody = z.object({ shop, phone });
const verifyBody = z.object({
  shop,
  phone,
  code: z.string().regex(new RegExp(`^\\d{${OTP_LENGTH}}$`)),
  fpRequestId: z.string().optional(),
});

const TRUST_COOKIE_MAX_AGE = 60 * 24 * 60 * 60; // 60 days, matches TRUST_DAYS

const otpRoutes: FastifyPluginAsync = async (app) => {
  // Tighter limits than the global default
  const limit = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

  app.post("/send", limit, async (req, reply) => {
    const body = sendBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });

    let result;
    try {
      result = await sendOtp(body.data.shop, body.data.phone);
    } catch (err) {
      req.log.error({ err }, "otp send failed");
      return reply.code(502).send({ error: "send_failed" });
    }
    if (!result.ok) {
      return reply
        .code(429)
        .header("Retry-After", result.retryAfter)
        .send({ error: result.reason, retryAfter: result.retryAfter });
    }
    return { sent: true, expiresIn: result.expiresIn };
  });

  app.post("/verify", limit, async (req, reply) => {
    const body = verifyBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    const { shop, phone, code, fpRequestId } = body.data;

    const result = await verifyOtp(shop, phone, code);
    if (result !== "ok") {
      return reply.code(result === "locked" ? 429 : 400).send({ error: result });
    }

    // Customer.phone is globally unique; ids have no DB default so we supply one.
    const customer = await prisma.customer.upsert({
      where: { phone },
      update: {},
      create: { id: randomUUID(), phone },
    });

    // Every verified login rotates the device cookie: the old device record is retired,
    // so a stolen old cookie stops working.
    const oldCookie = req.cookies[DEVICE_COOKIE];
    if (oldCookie) {
      await prisma.trustedDevice.updateMany({
        where: { cookieHash: sha256(oldCookie) },
        data: { revokedAt: new Date(), cookieHash: null },
      });
    }

    // Remember this device so recognize() can skip OTP next time.
    // Only a confident, non-risky fingerprint is stored (a weak match could recognise the wrong person).
    const fp = await verifyDevice(fpRequestId, shop);
    const fpUsable = !!fp && !fp.risky && fp.confidence >= 0.9;
    const cookieRaw = randomBytes(32).toString("base64url");
    const device = await prisma.trustedDevice.create({
      data: {
        id: randomUUID(),
        customerId: customer.id,
        cookieHash: sha256(cookieRaw),
        fpVisitorId: fpUsable ? fp.visitorId : null,
        lastCountry: fp?.ipCountry ?? null,
        verifiedAt: new Date(),
        lastSeenAt: new Date(),
      },
    });

    reply.setCookie(DEVICE_COOKIE, cookieRaw, {
      httpOnly: true,
      secure: true,
      sameSite: "none", // storefront embeds us in an iframe
      path: "/",
      maxAge: TRUST_COOKIE_MAX_AGE,
    });

    const token = await issueSession(
      {
        deviceId: device.id,
        customerId: customer.id,
        phone,
        firstName: customer.firstName ?? null,
        via: "cookie",
      },
      shop,
    );
    return { token, firstName: customer.firstName ?? null };
  });
};

export default otpRoutes;
