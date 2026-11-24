import path from "path";
import Fastify from "fastify";
import autoload from "@fastify/autoload";
import { config } from "@/config";
import embedRoutes from "@/embed";
import recoverRedirectRoutes from "./lib/recover-redirect";

export async function buildApp() {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    trustProxy: true,
  });

  // Shared setup (cors, helmet, cookie, rate limit, ...) — applies app-wide.
  await app.register(autoload, { dir: path.join(__dirname, "plugins") });

  app.get("/health", async () => ({ status: "ok" }));

  // Folder names become URL prefixes: routes/auth/otp/index.ts -> /api/auth/otp
  await app.register(autoload, {
    dir: path.join(__dirname, "routes"),
    options: { prefix: "/api" },
  });
  await app.register(recoverRedirectRoutes, { prefix: "/r" });
  // Consent popup: storefront loader, iframe page, dashboard preview (not under /api)
  await app.register(embedRoutes);

  return app;
}
