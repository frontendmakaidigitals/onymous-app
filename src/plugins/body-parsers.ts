import fp from "fastify-plugin";

/**
 * Storefront snippets may post JSON as text/plain (sendBeacon / avoiding CORS preflight).
 * Next's req.json() accepted that, so keep parity. Bad JSON becomes {} and
 * the route's own validation rejects it.
 */
export default fp(async (app) => {
  app.addContentTypeParser("text/plain", { parseAs: "string" }, (_req, body, done) => {
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(null, {});
    }
  });
}, { name: "body-parsers" });
