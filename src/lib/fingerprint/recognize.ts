import { randomBytes, createHash } from "crypto";
import redis from "@/lib/redis";
import { prisma } from "@/lib/prisma";
import { verifyDevice } from "@/lib/fingerprint/fingerprint";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export const DEVICE_COOKIE = "gc_dev";
const TRUST_DAYS = 60;
const SESSION_TTL = 60 * 60; // 1 hour
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_CONFIDENCE = 0.94;

export type Match = {
    deviceId: string;
    customerId: string;
    phone: string;
    firstName: string | null;
    via: "cookie" | "fingerprint";
};

export async function issueSession(m: Match, shop: string) {
    const token = randomBytes(32).toString("base64url");
    await redis.set(
        `gc:idsess:${token}`,
        JSON.stringify({ customerId: m.customerId, phone: m.phone, shop, deviceId: m.deviceId }),
        "EX",
        SESSION_TTL,
    );
    return token;
}

async function touch(deviceId: string, lastSeenAt: Date) {
    // Throttled: at most one write per device per day
    if (lastSeenAt < new Date(Date.now() - DAY_MS)) {
        await prisma.trustedDevice.update({
            where: { id: deviceId },
            data: { lastSeenAt: new Date() },
        });
    }
}

/** Path 1: device cookie (Chrome/Android with third-party cookies allowed). */
export async function byCookie(cookieRaw: string | undefined): Promise<Match | null> {
    if (!cookieRaw) return null;

    const d = await prisma.trustedDevice.findUnique({
        where: { cookieHash: sha256(cookieRaw) },
        include: { Customer: { select: { id: true, phone: true, firstName: true } } },
    });

    const trustedSince = new Date(Date.now() - TRUST_DAYS * DAY_MS);
    if (!d || d.revokedAt || d.verifiedAt < trustedSince || !d.Customer.phone) {
        console.info("[recognize] cookie present but not trusted");
        return null;
    }

    await touch(d.id, d.lastSeenAt);
    return {
        deviceId: d.id,
        customerId: d.Customer.id,
        phone: d.Customer.phone,
        firstName: d.Customer.firstName,
        via: "cookie",
    };
}

/** Path 2: server-verified fingerprint (Safari, iPhone, cookie-blocked browsers). */
export async function byFingerprint(fpRequestId: string | undefined): Promise<Match | null> {
    const fp = await verifyDevice(fpRequestId);

    if (!fp) {
        console.info("[recognize] no fingerprint signal");
        return null;
    }
    if (fp.risky || fp.confidence < MIN_CONFIDENCE) {
        console.info("[recognize] fingerprint rejected", {
            visitorId: fp.visitorId,
            confidence: fp.confidence,
            risky: fp.risky,
        });
        return null;
    }

    const trustedSince = new Date(Date.now() - TRUST_DAYS * DAY_MS);
    const rows = await prisma.trustedDevice.findMany({
        where: { fpVisitorId: fp.visitorId, revokedAt: null, verifiedAt: { gte: trustedSince } },
        include: { Customer: { select: { id: true, phone: true, firstName: true } } },
        orderBy: { verifiedAt: "desc" },
    });

    if (rows.length === 0) {
        console.info("[recognize] no trusted device for", fp.visitorId);
        return null;
    }

    // Collision guard: this fingerprint must belong to exactly ONE customer.
    const customers = new Set(rows.map((r) => r.customerId));
    if (customers.size !== 1) {
        console.info("[recognize] fingerprint shared by multiple customers, skipping", fp.visitorId);
        return null;
    }

    const latest = rows[0];
    if (!latest?.Customer.phone) return null;

    // Country jump since last verified login → require OTP
    if (latest.lastCountry && fp.ipCountry && latest.lastCountry !== fp.ipCountry) {
        console.info("[recognize] country changed, skipping", latest.lastCountry, "→", fp.ipCountry);
        return null;
    }

    await touch(latest.id, latest.lastSeenAt);
    return {
        deviceId: latest.id,
        customerId: latest.Customer.id,
        phone: latest.Customer.phone,
        firstName: latest.Customer.firstName,
        via: "fingerprint",
    };
}

/** Cookie first (free); fingerprint only if a requestId is provided. */
export async function recognize(opts: {
    cookie?: string;
    fpRequestId?: string;
}): Promise<Match | null> {
    return (
        (await byCookie(opts.cookie)) ??
        (opts.fpRequestId ? await byFingerprint(opts.fpRequestId) : null)
    );
}