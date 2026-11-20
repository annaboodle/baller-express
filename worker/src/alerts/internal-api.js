import { createD1AlertStore } from "./d1-alert-store.js";
import { verifyInternalRequest } from "./hmac.js";

const JSON_HEADERS = Object.freeze({
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
});
const MAX_BODY_BYTES = 4_096;
const MAX_LEASE_COUNT = 10;
const LEASE_SECONDS = 5 * 60;
const MAX_RETRY_SECONDS = 6 * 60 * 60;

function response(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

async function readLimitedBody(request) {
  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader !== null) {
    const declaredLength = Number(lengthHeader);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return { tooLarge: true };
    }
  }
  if (!request.body) return { body: "" };

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let body = "";
  let receivedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (receivedBytes > MAX_BODY_BYTES) {
      await reader.cancel();
      return { tooLarge: true };
    }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  return { body };
}

function defaultUuid() {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new Error("Secure UUID generation is unavailable.");
  }
  return globalThis.crypto.randomUUID();
}

function integer(value, { min, max, fallback }) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) return null;
  return value;
}

function exactKeys(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value).every((key) => allowed.includes(key));
}

function publicAlert(row) {
  return Object.freeze({
    alertId: row.alert_id,
    rule: row.rule_key,
    count: Number(row.observed_count),
    threshold: Number(row.threshold),
    windowSeconds: Number(row.window_seconds),
    firstObservedAt: Number(row.first_observed_at),
    attempts: Number(row.attempts),
    leaseToken: row.lease_token,
    leaseExpiresAt: Number(row.lease_expires_at),
  });
}

export function createInternalAlertApi({
  store = createD1AlertStore(),
  cleanup = async () => {},
  now = Date.now,
  randomUuid = defaultUuid,
  cryptoImpl = globalThis.crypto,
} = {}) {
  return Object.freeze({
    async handle(request, env) {
      try {
        const url = new URL(request.url);
        if (
          request.method !== "POST" ||
          !url.pathname.startsWith("/internal/v1/alerts/")
        ) {
          return response(404, { error: "not_found" });
        }
        const bodyResult = await readLimitedBody(request);
        if (bodyResult.tooLarge) {
          return response(413, { error: "invalid_request" });
        }
        const body = bodyResult.body;
        const nowSeconds = Math.floor(now() / 1_000);
        const authenticated = await verifyInternalRequest({
          secret: env?.ALERT_POLL_SECRET,
          timestamp: request.headers.get("x-baller-timestamp"),
          signature: request.headers.get("x-baller-signature"),
          method: request.method,
          path: url.pathname,
          body,
          nowSeconds,
          cryptoImpl,
        });
        if (!authenticated) {
          return response(401, { error: "unauthorized" });
        }

        let input;
        try {
          input = body ? JSON.parse(body) : {};
        } catch {
          return response(400, { error: "invalid_request" });
        }

        if (url.pathname === "/internal/v1/alerts/lease") {
          if (!exactKeys(input, ["limit"])) {
            return response(400, { error: "invalid_request" });
          }
          const limit = integer(input.limit, {
            min: 1,
            max: MAX_LEASE_COUNT,
            fallback: 5,
          });
          if (limit === null) {
            return response(400, { error: "invalid_request" });
          }
          await cleanup({ env });
          const leaseToken = randomUuid();
          const rows = await store.leaseAlerts({
            env,
            nowSeconds,
            leaseToken,
            leaseSeconds: LEASE_SECONDS,
            limit,
          });
          return response(200, { alerts: rows.map(publicAlert) });
        }

        if (url.pathname === "/internal/v1/alerts/ack") {
          if (
            !exactKeys(input, ["alertId", "leaseToken"]) ||
            typeof input.alertId !== "string" ||
            typeof input.leaseToken !== "string"
          ) {
            return response(400, { error: "invalid_request" });
          }
          const acknowledged = await store.acknowledge({
            env,
            alertId: input.alertId,
            leaseToken: input.leaseToken,
            nowSeconds,
          });
          return response(acknowledged ? 200 : 409, {
            acknowledged,
          });
        }

        if (url.pathname === "/internal/v1/alerts/nack") {
          if (
            !exactKeys(input, ["alertId", "leaseToken", "retryAfterSeconds"]) ||
            typeof input.alertId !== "string" ||
            typeof input.leaseToken !== "string"
          ) {
            return response(400, { error: "invalid_request" });
          }
          const retryAfterSeconds = integer(input.retryAfterSeconds, {
            min: 60,
            max: MAX_RETRY_SECONDS,
            fallback: 5 * 60,
          });
          if (retryAfterSeconds === null) {
            return response(400, { error: "invalid_request" });
          }
          const retried = await store.retry({
            env,
            alertId: input.alertId,
            leaseToken: input.leaseToken,
            availableAt: nowSeconds + retryAfterSeconds,
            nowSeconds,
          });
          return response(retried ? 200 : 409, { retried });
        }

        return response(404, { error: "not_found" });
      } catch {
        return response(503, { error: "alert_service_unavailable" });
      }
    },
  });
}
