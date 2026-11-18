// Consent popup pages + browser bundles (not under /api).
//
//   GET /onymous-consent.js        storefront loader (theme <script>)
//   GET /embed/consent.js          popup bundle for the iframe page
//   GET /embed/consent             live popup, framed by the shop's storefront
//   GET /embed/consent/preview     static preview, framed by the dashboard
//
//   GET /login                     theme snippet's login panel (+ ?silent=1 probe)
//
// Bundles (React popup, Tailwind CSS, loader) are built by `npm run build:client` into dist/public.
import { readFile } from "fs/promises";
import path from "path";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { config } from "@/config";
import { getPublicPopupConfig } from "@/lib/consent/public-config";
import {
  DEFAULT_PRIMARY,
  DEFAULT_TEMPLATE,
  HEX_RE,
  isTemplateKey,
  resolveContent,
  type PopupBootstrap,
} from "@/lib/consent/templates";
import { isStoreOrigin, storeOrigins } from "@/lib/store-origin";

const PUBLIC_DIR = path.join(process.cwd(), "dist", "public");
const cache = new Map<string, string>();

async function bundle(name: string): Promise<string | null> {
  if (config.NODE_ENV === "production" && cache.has(name)) return cache.get(name)!;
  try {
    const js = await readFile(path.join(PUBLIC_DIR, name), "utf8");
    if (config.NODE_ENV === "production") cache.set(name, js);
    return js;
  } catch {
    return null;
  }
}

const dashboardOrigins = () =>
  config.DASHBOARD_ORIGINS.split(",")
    .map((o) => o.trim())
    .filter(Boolean);

/** CSP for the popup page. Fingerprint Pro (region "ap") loads from fpcdn.io and talks to *.fpjs.io. */
function csp(frameAncestors: string[]) {
  return [
    "default-src 'self'",
    "script-src 'self' https://fpcdn.io https://*.fpjs.io",
    "connect-src 'self' https://*.fpjs.io https://*.api.fpjs.io",
    "img-src 'self' https: data:",
    "style-src 'self' 'unsafe-inline'",
    "base-uri 'none'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors.length ? frameAncestors.join(" ") : "'none'"}`,
  ].join("; ");
}

async function sendPage(reply: FastifyReply, boot: PopupBootstrap | null, frameAncestors: string[]) {
  // Tailwind output (npm run build:client), inlined so the popup paints in one request
  const css = boot ? ((await bundle("consent.css")) ?? "") : "";
  // helmet sets X-Frame-Options: SAMEORIGIN app-wide; frame-ancestors replaces it here
  reply.removeHeader("x-frame-options");
  reply
    .header("Content-Security-Policy", csp(frameAncestors))
    .header("Cache-Control", "no-store")
    .type("text/html; charset=utf-8");

  // Embedded JSON: escape "<" so content can never close the script tag
  const json = boot ? JSON.stringify(boot).replace(/</g, "\\u003c") : "null";
  return reply.send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Sign in</title>
<style>${css}</style>
</head>
<body>
<div id="onymous-root"></div>
${boot ? `<script type="application/json" id="onymous-bootstrap">${json}</script>
<script src="/embed/consent.js" defer></script>` : ""}
</body>
</html>`);
}

function decodeContent(raw: string | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

const embedRoutes: FastifyPluginAsync = async (app) => {
  app.get("/onymous-consent.js", async (_req, reply) => {
    const js = await bundle("onymous-consent.js");
    if (!js) return reply.code(503).send("// consent loader not built: run npm run build:client");
    return reply
      .type("application/javascript; charset=utf-8")
      // Loaded cross-origin by every storefront; helmet defaults CORP to same-origin
      .header("Cross-Origin-Resource-Policy", "cross-origin")
      .header("Access-Control-Allow-Origin", "*")
      .header("Cache-Control", "public, max-age=300")
      .send(js);
  });

  // Font + logo for the popup page. Fixed allow-list, so no path tricks.
  const ASSETS: Record<string, string> = { "inter.woff2": "font/woff2", "onymous-logo.png": "image/png" };
  app.get<{ Params: { name: string } }>("/embed/assets/:name", async (req, reply) => {
    const type = ASSETS[req.params.name];
    if (!type) return reply.code(404).send();
    try {
      const file = await readFile(path.join(PUBLIC_DIR, "assets", req.params.name));
      return reply.type(type).header("Cache-Control", "public, max-age=86400").send(file);
    } catch {
      return reply.code(503).send();
    }
  });

  app.get("/embed/consent.js", async (_req, reply) => {
    const js = await bundle("consent.js");
    if (!js) return reply.code(503).send("// consent bundle not built: run npm run build:client");
    return reply.type("application/javascript; charset=utf-8").header("Cache-Control", "public, max-age=300").send(js);
  });

  // Live popup inside the storefront
  app.get<{ Querystring: { shop?: string; origin?: string } }>("/embed/consent", async (req, reply) => {
    const found = await getPublicPopupConfig(req.query.shop);
    const origin = req.query.origin ?? null;
    if (!found?.config?.enabled || !isStoreOrigin(origin, found.store)) {
      // Nothing to show (or not this shop's storefront): render an empty, un-frameable page
      return sendPage(reply, null, []);
    }
    const { config: cfg, store } = found;
    return sendPage(
      reply,
      {
        mode: "live",
        shop: store.shopDomain,
        parentOrigin: origin,
        previewOrigin: null,
        templateKey: cfg.templateKey,
        content: cfg.content,
        primaryColor: cfg.primaryColor,
      },
      storeOrigins(store),
    );
  });

  // Login panel used by the theme snippet (gc-header-btn / auto-prompt / silent probe):
  //   /login?shop=<shop>&layout=auto   the active template, placed like the dashboard preview
  //                                    (overlay / corner card / bottom bar). The snippet sizes its
  //                                    iframe from onymous:ready + onymous:resize, like onymous-consent.js.
  //   /login?shop=<shop>               legacy: fills the snippet's own fixed sheet
  //   /login?shop=<shop>&silent=1      recognise device, send GC_AUTH_STATE, no UI
  // Always available (header button), whether or not the dashboard toggle is on.
  app.get<{ Querystring: { shop?: string; silent?: string; layout?: string } }>("/login", async (req, reply) => {
    const found = await getPublicPopupConfig(req.query.shop);
    if (!found) return sendPage(reply, null, []);
    const { store, config: cfg } = found;
    const origins = storeOrigins(store);
    const fallback = resolveContent(null, store.name);
    const auto = req.query.layout === "auto";

    // Legacy sheet: a page-docked banner can't fill a fixed sheet, so show split there
    const active = cfg?.templateKey ?? DEFAULT_TEMPLATE;
    const key = !auto && active === "banner" ? "split" : active;
    return sendPage(
      reply,
      {
        mode: req.query.silent === "1" ? "silent" : "panel",
        placement: auto ? "auto" : "fill",
        allowedParents: origins,
        shop: store.shopDomain,
        parentOrigin: null, // resolved in the browser and checked against allowedParents
        previewOrigin: null,
        templateKey: key,
        content: cfg?.content ?? fallback,
        primaryColor: cfg?.primaryColor ?? DEFAULT_PRIMARY,
      },
      origins,
    );
  });

  // Preview for the dashboard gallery / Customize panel
  app.get<{ Querystring: { template?: string; c?: string; color?: string; parent?: string } }>(
    "/embed/consent/preview",
    async (req, reply) => {
      const allowed = dashboardOrigins();
      const parent = req.query.parent && allowed.includes(req.query.parent) ? req.query.parent : null;
      const color = req.query.color && HEX_RE.test(req.query.color) ? req.query.color : DEFAULT_PRIMARY;
      const content = decodeContent(req.query.c);
      const brand =
        content && typeof content === "object" && typeof (content as { brandName?: unknown }).brandName === "string"
          ? (content as { brandName: string }).brandName
          : "";
      return sendPage(
        reply,
        {
          mode: "preview",
          shop: null,
          parentOrigin: null,
          previewOrigin: parent,
          templateKey: isTemplateKey(req.query.template) ? req.query.template : DEFAULT_TEMPLATE,
          content: resolveContent(content, brand),
          primaryColor: color,
        },
        allowed,
      );
    },
  );
};

export default embedRoutes;
