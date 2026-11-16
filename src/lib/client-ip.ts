// Customer IP / UA for routes called directly from the checkout (the
// customer's browser). NEVER use this in a PSP webhook — there the request
// comes from Stripe/Paymob/Tabby/Tamara, not the customer.
import type { FastifyRequest } from "fastify";
 

const LOCAL_IPS = new Set(["", "unknown", "::1", "127.0.0.1", "::ffff:127.0.0.1"]);

const header = (request: FastifyRequest, name: string): string | undefined => {
    const v = request.headers[name];
    return Array.isArray(v) ? v[0] : v;
};

export function getClientIp(request: FastifyRequest): string {
    const candidates = [
        header(request, "cf-connecting-ip"),
        header(request, "x-forwarded-for")?.split(",")[0],
        header(request, "x-real-ip"),
    ];
    for (const c of candidates) {
        const ip = (c ?? "").trim();
        if (ip && !LOCAL_IPS.has(ip)) return ip;
    }
    return "";
}

 
