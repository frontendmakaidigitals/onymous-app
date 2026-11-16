import Redis from "ioredis";

const redis = new Redis({
  host: process.env.REDIS_HOST!,
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 100, 2000),
  lazyConnect: true,
});

redis.on("error", (err) => console.error("[Redis] Error:", err));

export default redis;