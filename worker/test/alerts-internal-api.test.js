import assert from "node:assert/strict";
import test from "node:test";

import { signInternalRequest } from "../src/alerts/hmac.js";
import { createInternalAlertApi } from "../src/alerts/internal-api.js";

const SECRET = "0123456789abcdef0123456789abcdef";
const NOW_MS = 1_800_000_000_000;
const NOW_SECONDS = NOW_MS / 1_000;

function deliveryStore() {
  const calls = [];
  return {
    calls,
    async leaseAlerts(context) {
      calls.push({ method: "lease", context });
      return [
        {
          alert_id: "alert-1",
          rule_key: "attempts_10m",
          observed_count: 100,
          threshold: 100,
          window_seconds: 600,
          first_observed_at: NOW_SECONDS,
          attempts: 1,
          lease_token: context.leaseToken,
          lease_expires_at: NOW_SECONDS + 300,
        },
      ];
    },
    async acknowledge(context) {
      calls.push({ method: "ack", context });
      return true;
    },
    async retry(context) {
      calls.push({ method: "nack", context });
      return true;
    },
  };
}

async function signedRequest(path, input, overrides = {}) {
  const body = JSON.stringify(input);
  const timestamp = overrides.timestamp || NOW_SECONDS;
  const signature = await signInternalRequest(
    SECRET,
    { timestamp, method: "POST", path, body },
  );
  return new Request(`https://staging.invalid${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-baller-timestamp": String(timestamp),
      "x-baller-signature": overrides.signature || signature,
    },
    body,
  });
}

test("signed lease returns only aggregate operational fields and no CORS", async () => {
  const store = deliveryStore();
  let cleanupCalls = 0;
  const api = createInternalAlertApi({
    store,
    async cleanup() {
      cleanupCalls += 1;
    },
    now: () => NOW_MS,
    randomUuid: () => "lease-1",
  });
  const request = await signedRequest("/internal/v1/alerts/lease", { limit: 2 });
  const response = await api.handle(request, { ALERT_POLL_SECRET: SECRET });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.has("access-control-allow-origin"), false);
  assert.deepEqual(body, {
    alerts: [
      {
        alertId: "alert-1",
        rule: "attempts_10m",
        count: 100,
        threshold: 100,
        windowSeconds: 600,
        firstObservedAt: NOW_SECONDS,
        attempts: 1,
        leaseToken: "lease-1",
        leaseExpiresAt: NOW_SECONDS + 300,
      },
    ],
  });
  assert.equal(JSON.stringify(body).includes("email"), false);
  assert.equal(JSON.stringify(body).includes("token-value"), false);
  assert.equal(cleanupCalls, 1);
});

test("acknowledgement and retry pass only server-owned identifiers", async () => {
  const store = deliveryStore();
  const api = createInternalAlertApi({ store, now: () => NOW_MS });

  const ack = await api.handle(
    await signedRequest("/internal/v1/alerts/ack", {
      alertId: "alert-1",
      leaseToken: "lease-1",
    }),
    { ALERT_POLL_SECRET: SECRET },
  );
  assert.equal(ack.status, 200);

  const nack = await api.handle(
    await signedRequest("/internal/v1/alerts/nack", {
      alertId: "alert-2",
      leaseToken: "lease-2",
      retryAfterSeconds: 900,
    }),
    { ALERT_POLL_SECRET: SECRET },
  );
  assert.equal(nack.status, 200);
  assert.deepEqual(
    store.calls.map((call) => call.method),
    ["ack", "nack"],
  );
  assert.equal(store.calls[1].context.availableAt, NOW_SECONDS + 900);
});

test("bad or stale signatures fail before touching the outbox", async () => {
  const store = deliveryStore();
  const api = createInternalAlertApi({ store, now: () => NOW_MS });

  const bad = await api.handle(
    await signedRequest(
      "/internal/v1/alerts/lease",
      {},
      { signature: "0".repeat(64) },
    ),
    { ALERT_POLL_SECRET: SECRET },
  );
  assert.equal(bad.status, 401);

  const stale = await api.handle(
    await signedRequest(
      "/internal/v1/alerts/lease",
      {},
      { timestamp: NOW_SECONDS - 301 },
    ),
    { ALERT_POLL_SECRET: SECRET },
  );
  assert.equal(stale.status, 401);
  assert.equal(store.calls.length, 0);
});

test("unexpected fields and oversized retry delays are rejected", async () => {
  const store = deliveryStore();
  const api = createInternalAlertApi({ store, now: () => NOW_MS });

  const extra = await api.handle(
    await signedRequest("/internal/v1/alerts/ack", {
      alertId: "alert-1",
      leaseToken: "lease-1",
      contributorEmail: "private@example.invalid",
    }),
    { ALERT_POLL_SECRET: SECRET },
  );
  assert.equal(extra.status, 400);

  const excessiveRetry = await api.handle(
    await signedRequest("/internal/v1/alerts/nack", {
      alertId: "alert-1",
      leaseToken: "lease-1",
      retryAfterSeconds: 86_400,
    }),
    { ALERT_POLL_SECRET: SECRET },
  );
  assert.equal(excessiveRetry.status, 400);
  assert.equal(store.calls.length, 0);
});

test("oversized bodies are rejected before authentication or D1 access", async () => {
  const store = deliveryStore();
  const api = createInternalAlertApi({ store, now: () => NOW_MS });
  const response = await api.handle(
    new Request("https://staging.invalid/internal/v1/alerts/lease", {
      method: "POST",
      body: "x".repeat(4_097),
    }),
    { ALERT_POLL_SECRET: SECRET },
  );

  assert.equal(response.status, 413);
  assert.equal(store.calls.length, 0);
});
