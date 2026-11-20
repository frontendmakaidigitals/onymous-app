import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.string().default("info"),
  CORS_ORIGINS: z.string().default(""),
  DASHBOARD_ORIGINS: z.string().default("http://localhost:3000"),
  /** Public dashboard URL, used to make uploaded store logos absolute. Default: first DASHBOARD_ORIGINS entry. */
  DASHBOARD_URL: z.string().optional(),
});

const env = schema.parse(process.env);

export const config = {
  ...env,
  DASHBOARD_URL: (env.DASHBOARD_URL || env.DASHBOARD_ORIGINS.split(",")[0] || "").trim().replace(/\/+$/, ""),
  PORT: Number(process.env.PORT) || 4000,
};