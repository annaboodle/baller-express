import { hmacSha256Hex } from "./crypto.js";
import { createD1Store } from "./d1-store.js";

function positiveInteger(env, name) {
  const value = Number(env?.[name]);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

export function createD1RateLimiter({
  store = createD1Store(),
  now = () => Date.now(),
  hash = hmacSha256Hex,
} = {}) {
  return Object.freeze({
    async check({ env, endpoint, sourceIp }) {
      if (typeof endpoint !== "string" || !endpoint.startsWith("/v1/")) {
        throw new Error("A valid endpoint is required.");
      }
      if (typeof sourceIp !== "string" || sourceIp.length === 0) {
        throw new Error("The source IP is unavailable.");
      }

      const windowSeconds = positiveInteger(env, "RATE_LIMIT_WINDOW_SECONDS");
      const maxAttempts = positiveInteger(env, "RATE_LIMIT_MAX_ATTEMPTS");
      const retentionSeconds = positiveInteger(
        env,
        "RATE_LIMIT_RETENTION_SECONDS",
      );
      if (retentionSeconds < windowSeconds) {
        throw new Error("Rate-limit retention must cover at least one window.");
      }

      const nowSeconds = Math.floor(now() / 1000);
      const bucketStart =
        Math.floor(nowSeconds / windowSeconds) * windowSeconds;
      const bucketKey = await hash(
        env?.RATE_LIMIT_SECRET,
        `${endpoint}\0${sourceIp}`,
      );
      const count = await store.incrementRateWindow({
        env,
        bucketKey,
        bucketStart,
        expiresBefore: nowSeconds - retentionSeconds,
      });

      return {
        allowed: count <= maxAttempts,
        retryAfterSeconds: Math.max(
          1,
          bucketStart + windowSeconds - nowSeconds,
        ),
      };
    },
  });
}
