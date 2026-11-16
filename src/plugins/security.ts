import fp from "fastify-plugin";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import { config } from "@/config";

export default fp(async (app) => {
  await app.register(helmet);
  await app.register(cors, {
    origin: config.CORS_ORIGINS ? config.CORS_ORIGINS.split(",").map((o) => o.trim()) : false,
    credentials: true,
  });
}, { name: "security" });
