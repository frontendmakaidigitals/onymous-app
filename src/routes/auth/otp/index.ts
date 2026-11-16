import type { FastifyPluginAsync } from "fastify";
import { createHash, randomBytes, randomUUID } from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { sendOtp, verifyOtp } from "@/lib/otp";
import { verifyDevice } from "@/lib/fingerprint/fingerprint";
import { DEVICE_COOKIE, issueSession } from "@/lib/fingerprint/recognize";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const phone = z.string().trim().regex(/^\+[1-9]\d{7,14}$/, "Phone must be in E.164 format");
const shop = z.string().trim().min(1).max(255);

const sendBody = z.object({ shop, phone });
const verifyBody = z.object({
  shop,
  phone,
  code: z.string().regex(/^\d{6}$/),
  fpRequestId: z.string().optional(),
});

const TRUST_COOKIE_MAX_AGE = 60 * 24 * 60 * 60; // 60 days, matches TRUST_DAYS

const otpRoutes: FastifyPluginAsync = async (app) => {
  // Tighter limits than the global default
  const limit = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

  app.post("/send", limit, async (req, reply) => {
    const body = sendBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });

    const result = await sendOtp(body.data.shop, body.data.phone);
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

    // Remember this device so recognize() can skip OTP next time.
    const fp = await verifyDevice(fpRequestId);
    const cookieRaw = randomBytes(32).toString("base64url");
    const device = await prisma.trustedDevice.create({
      data: {
        id: randomUUID(),
        customerId: customer.id,
        cookieHash: sha256(cookieRaw),
        fpVisitorId: fp && !fp.risky ? fp.visitorId : null,
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
