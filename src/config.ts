import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.string().default("info"),
  CORS_ORIGINS: z.string().default(""),
  // Dashboard origin(s) allowed to frame /embed/consent/preview, comma-separated
  DASHBOARD_ORIGINS: z.string().default("http://localhost:4100"),
});

export const config = schema.parse(process.env);
