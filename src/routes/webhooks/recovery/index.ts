// Recovery-provider webhook (Zoko, Bitespeed, Make, ...): message status, clicks and purchases.
// Ported from checkout-app/app/api/webhooks/recovery/route.ts so the URL providers already
// have keeps working now that useonymous.com is served by this app.
//
// POST /api/webhooks/recovery?key=<store secret>&source=<provider>&shop=<shop>[&event=..][&target=..][&template=..]
//   key      : the store's secret (Store.storeSecret), or header x-gc-secret
//   source   : free text for logs
//   shop     : myshopify or public domain (or body.shop); required, it selects the secret
//   event    : sent | delivered | read | failed | clicked | purchase   (or body.event / body.status)
//   target   : cart (default) | browse   (delivery events only)
//   template : only accept status events for this template (account-level webhooks send every message)
//
// GET: endpoint verification, echoes ?challenge / ?hub.challenge.
//
// Row lookup for delivery/click events: body gc_id | cart_id | recovery_id | id (the id we send
// in the payload); fallback = latest messaged row for shop + phone.
// Purchase events: same matching as storefront orders (recovery id, phones, email, cart token).
import { timingSafeEqual } from "crypto";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { markAbandonedCartPurchased, phoneCandidates } from "@/lib/abandoned-cart";

type Obj = Record<string, unknown>;
type Ev = "sent" | "delivered" | "read" | "failed" | "clicked" | "purchase";
type Target = "cart" | "browse";
type Query = Partial<Record<"key" | "source" | "shop" | "event" | "target" | "template" | "challenge" | "hub.challenge" | "challenge_token", string>>;

const ALIASES: Record<Ev, string[]> = {
  sent: ["sent", "message_sent", "accepted", "queued"],
  delivered: ["delivered", "message_delivered"],
  read: ["read", "seen", "message_read", "opened"],
  failed: ["failed", "undelivered", "error", "message_failed", "rejected"],
  clicked: ["clicked", "click", "link_clicked"],
  purchase: ["purchase", "purchased", "order", "order_created", "order_placed", "order_paid"],
};

const RANK = { sent: 1, delivered: 2, read: 3 } as const;
const rankOf = (s: string | null) => (s && s in RANK ? RANK[s as keyof typeof RANK] : 0);

function normalizeEvent(v: string | null | undefined): Ev | null {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  for (const [ev, names] of Object.entries(ALIASES) as [Ev, string[]][]) {
    if (names.includes(s)) return ev;
  }
  return null;
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Store's own secret; the global RECOVERY_WEBHOOK_SECRET still works until every provider URL is migrated. */
function authorizedFor(req: FastifyRequest<{ Querystring: Query }>, storeSecretEnc: string | null): boolean {
  const header = req.headers["x-gc-secret"];
  const given = req.query.key ?? (typeof header === "string" ? header : "") ?? "";
  if (!given) return false;
  if (storeSecretEnc) {
    let own: string | null = null;
    try {
      own = decrypt(storeSecretEnc);
    } catch {
      own = null;
    }
    if (own && safeEqual(given, own)) return true;
  }
  const legacy = process.env.RECOVERY_WEBHOOK_SECRET;
  return !!legacy && safeEqual(given, legacy);
}

function get(o: unknown, path: string): unknown {
  let cur: unknown = o;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Obj)[part];
  }
  return cur;
}

const isSet = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== "";

function first(o: unknown, ...paths: string[]): string | null {
  for (const p of paths) {
    const v = get(o, p);
    if (isSet(v) && typeof v !== "object") return String(v).trim();
  }
  return null;
}

function all(o: unknown, ...paths: string[]): string[] {
  const out = new Set<string>();
  for (const p of paths) {
    const v = get(o, p);
    if (isSet(v) && typeof v !== "object") out.add(String(v).trim());
  }
  return [...out];
}

function asNumber(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function asDate(v: string | null): Date {
  if (!v) return new Date();
  const n = Number(v);
  const d = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(v);
  return Number.isNaN(d.getTime()) || d.getTime() > Date.now() + 60_000 ? new Date() : d;
}

function normalizeShop(v: string | null | undefined): string | null {
  if (!v) return null;
  return v.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase() || null;
}

function recoveryIdFrom(body: Obj): string | null {
  const direct = first(body, "gc_recover", "recover_id", "recoveryCartId");
  if (direct) return direct;
  const attrs = body.note_attributes;
  if (Array.isArray(attrs)) {
    const hit = attrs.find((a) => a && typeof a === "object" && (a as Obj).name === "gc_recover");
    if (hit && isSet((hit as Obj).value)) return String((hit as Obj).value);
  }
  return null;
}

// AbandonedCart and ProductView share the send/delivery columns
type DeliveryRow = {
  id: string;
  deliveryStatus: string | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  recoveryClickedAt?: Date | null;
};
type Delegate = {
  findFirst(args: unknown): Promise<DeliveryRow | null>;
  updateMany(args: unknown): Promise<{ count: number }>;
};
const delegate = (t: Target) => (t === "browse" ? prisma.productView : prisma.abandonedCart) as unknown as Delegate;

const recoveryWebhookRoutes: FastifyPluginAsync = async (app) => {
  // Some providers post form-encoded bodies; scoped to this plugin only.
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  // Providers send bursts from a few IPs; the app-wide limit (100/min) is too low here.
  const routeConfig = { rateLimit: { max: 1000, timeWindow: "1 minute" } };

  // Endpoint verification (Zoko / Meta-style): echo the challenge back
  app.get<{ Querystring: Query }>("/", { config: routeConfig }, async (req, reply) => {
    const q = req.query;
    const challenge = q["hub.challenge"] ?? q.challenge ?? q.challenge_token;
    return reply.type("text/plain").send(challenge ?? "ok");
  });

  app.post<{ Querystring: Query }>("/", { config: routeConfig }, async (req, reply) => {
    const q = req.query;
    const source = q.source ?? "unknown";
    const raw = req.body as Obj | null;
    if (!raw || typeof raw !== "object") return reply.code(400).send({ error: "Invalid JSON" });

    // Some tools wrap the payload: { order: {...} } / { data: {...} }
    const body: Obj =
      raw.order && typeof raw.order === "object" ? { ...raw, ...(raw.order as Obj) }
        : raw.data && typeof raw.data === "object" ? { ...raw, ...(raw.data as Obj) }
          : raw;

    // ── Store + auth (the store's secret decides access) ────────────────────
    const shopRaw = normalizeShop(first(body, "shop", "store", "shop_domain", "domain") ?? q.shop);
    const store = shopRaw
      ? await prisma.store.findFirst({
        where: { OR: [{ shopDomain: shopRaw }, { websiteUrl: { contains: shopRaw } }] },
        select: { shopDomain: true, storeSecret: true },
      })
      : null;
    if (!store?.shopDomain || !authorizedFor(req, store.storeSecret)) {
      req.log.warn({ source, shop: shopRaw }, "[recovery-webhook] unauthorized");
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const shop = store.shopDomain;

    // ── Event ───────────────────────────────────────────────────────────────
    const event = normalizeEvent(q.event ?? first(body, "event", "status", "type", "message_status"));
    if (!event) {
      req.log.warn({ source, body: JSON.stringify(raw).slice(0, 1000) }, "[recovery-webhook] unknown event");
      return reply.send({ ok: true, ignored: "unknown event" }); // 200 so the provider doesn't retry/disable
    }

    // Only our recovery template (account-level webhooks send every outgoing message)
    const wantTemplate = q.template;
    if (event !== "purchase" && wantTemplate) {
      const got = first(body, "template", "template_name", "templateId", "template_id", "templateName", "message.template");
      if (got && got !== wantTemplate) return reply.send({ ok: true, event, ignored: "other template" });
    }

    const phones = all(
      body,
      "phone", "phone_digits", "customer_phone", "mobile", "phone_number", "to", "recipient",
      "customer.phone", "billing_address.phone", "shipping_address.phone",
    );
    const at = asDate(first(body, "timestamp", "time", "event_time", "created_at"));

    // Append-only event log (stores."RecoveryEvent"): cart rows keep only the latest cycle, so
    // the dashboard attributes orders from these (delivered/read within a day before an order).
    // Logged even when no cart row matches, e.g. the provider's own follow-up messages.
    if (event !== "purchase") {
      const digits = (phones[0] ?? "").replace(/\D/g, "");
      const phoneKey = digits.length >= 8 ? digits.slice(-9) : null;
      const messageId =
        first(body, "message_id", "messageId", "msg_id", "zoko_message_id", "wamid", "message.id", "messageID") ??
        `${phoneKey ?? "?"}:${at.toISOString()}`; // no id from the provider: one row per phone + time
      try {
        await prisma.recoveryEvent.createMany({
          data: [{
            shop,
            provider: source.toLowerCase(),
            event,
            phone: phones[0] ?? null,
            phoneKey,
            at,
            messageId,
            orderId: "",
            template: first(body, "template", "template_name", "templateId", "template_id", "templateName", "message.template"),
            origin: "webhook",
          }],
          skipDuplicates: true,
        });
      } catch (err) {
        req.log.error({ err, source, event }, "[recovery-webhook] event log failed");
      }
    }

    try {
      // ── Purchase ──────────────────────────────────────────────────────────
      if (event === "purchase") {
        const email = first(body, "email", "customer_email", "contact_email", "customer.email");
        if (!phones.length && !email) return reply.code(400).send({ error: "Missing phone or email" });
        const orderId = first(body, "order_id", "orderId", "id") ?? first(body, "order_name", "name");
        const closed = await markAbandonedCartPurchased({
          shop,
          orderId,
          phones,
          email,
          recoveryCartId: recoveryIdFrom(body),
          gateway: first(body, "gateway", "payment_method", "payment_gateway", "payment_gateway_names.0"),
          orderTotal: asNumber(first(body, "total", "total_price", "amount", "order_total", "current_total_price")),
          orderCurrency: first(body, "currency", "presentment_currency"),
        });
        req.log.info({ source, shop, orderId, closed }, "[recovery-webhook] purchase");
        return reply.send({ ok: true, event, closed });
      }

      // ── Delivery / click ──────────────────────────────────────────────────
      const target: Target = (q.target ?? first(body, "target", "kind")) === "browse" ? "browse" : "cart";
      if (event === "clicked" && target === "browse") {
        return reply.send({ ok: true, event, updated: 0, note: "clicks are tracked on carts only" });
      }
      const model = delegate(target);
      const select = {
        id: true, deliveryStatus: true, deliveredAt: true, readAt: true,
        ...(target === "cart" ? { recoveryClickedAt: true } : {}),
      };

      // Row id we sent; scoped to this shop so one store's key can't touch another's rows
      const rowId = first(body, "gc_id", "cart_id", "recovery_id", "id");
      let row = rowId ? await model.findFirst({ where: { id: rowId, shop }, select }) : null;

      if (!row && phones.length) {
        const candidates = [...new Set(phones.flatMap((p) => phoneCandidates(p)))];
        row = await model.findFirst({
          where: { shop, phone: { in: candidates }, abandonedSentAt: { not: null } },
          orderBy: { abandonedSentAt: "desc" },
          select,
        });
      }
      if (!row) {
        req.log.warn(
          { source, event, target, rowId, shop, phones, body: JSON.stringify(raw).slice(0, 500) },
          "[recovery-webhook] no matching row",
        );
        return reply.send({ ok: true, event, updated: 0 }); // 200: nothing to retry
      }

      const current = rankOf(row.deliveryStatus);
      const data: Obj = {};

      switch (event) {
        case "sent":
          if (!row.deliveryStatus) data.deliveryStatus = "sent";
          break;
        case "delivered":
          if (!row.deliveredAt) data.deliveredAt = at;
          if (current < RANK.delivered) data.deliveryStatus = "delivered";
          break;
        case "read":
          if (!row.readAt) data.readAt = at;
          if (!row.deliveredAt) data.deliveredAt = at;
          data.deliveryStatus = "read";
          break;
        case "failed":
          data.deliveryFailedAt = at;
          data.deliveryError = (first(body, "error", "reason", "error_message", "message") ?? "Delivery failed").slice(0, 500);
          if (current < RANK.delivered) data.deliveryStatus = "failed"; // don't mark a delivered/read message failed
          break;
        case "clicked":
          if (!row.recoveryClickedAt) data.recoveryClickedAt = at;
          break;
      }

      const { count } = Object.keys(data).length
        ? await model.updateMany({ where: { id: row.id }, data })
        : { count: 0 };

      req.log.info({ source, event, target, id: row.id, updated: count }, "[recovery-webhook] status");
      return reply.send({ ok: true, event, target, id: row.id, updated: count });
    } catch (err) {
      req.log.error({ err, source, event }, "[recovery-webhook] failed");
      return reply.code(500).send({ error: "Failed to process" });
    }
  });
};

export default recoveryWebhookRoutes;
