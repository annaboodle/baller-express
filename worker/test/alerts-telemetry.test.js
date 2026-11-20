import assert from "node:assert/strict";
import test from "node:test";

import {
  ALERT_RETENTION_SECONDS,
  createAlertTelemetry,
} from "../src/alerts/telemetry.js";

function memoryStore() {
  const buckets = new Map();
  const nextEligible = new Map();
  const outbox = [];
  const cleanupCalls = [];
  return {
    buckets,
    nextEligible,
    outbox,
    cleanupCalls,
    async incrementMetric({ metric, bucketStart }) {
      const key = `${metric}:${bucketStart}`;
      buckets.set(key, (buckets.get(key) || 0) + 1);
    },
    async sumMetric({ metric, earliestBucket }) {
      let total = 0;
      for (const [key, count] of buckets.entries()) {
        const [storedMetric, storedBucket] = key.split(":");
        if (
          storedMetric === metric &&
          Number(storedBucket) >= earliestBucket
        ) {
          total += count;
        }
      }
      return total;
    },
    async enqueueAlertIfEligible(context) {
      const eligibleAt = nextEligible.get(context.rule.key) || 0;
      if (eligibleAt > context.nowSeconds) return false;
      nextEligible.set(
        context.rule.key,
        context.nowSeconds + context.rule.cooldownSeconds,
      );
      outbox.push({
        alertId: context.alertId,
        rule: context.rule.key,
        count: context.observedCount,
        threshold: context.rule.threshold,
        windowSeconds: context.rule.windowSeconds,
      });
      return true;
    },
    async cleanup(context) {
      cleanupCalls.push(context);
    },
  };
}

function uuidSequence() {
  let value = 0;
  return () => `alert-${++value}`;
}

test("attempt thresholds fire at 100 and 1,000, not before", async () => {
  const store = memoryStore();
  const telemetry = createAlertTelemetry({
    store,
    now: () => 1_800_000_000_000,
    randomUuid: uuidSequence(),
  });

  for (let count = 0; count < 99; count += 1) {
    await telemetry.recordAttempt({ env: {} });
  }
  assert.deepEqual(store.outbox, []);

  await telemetry.recordAttempt({ env: {} });
  assert.deepEqual(store.outbox.map((row) => row.rule), ["attempts_10m"]);

  for (let count = 100; count < 999; count += 1) {
    await telemetry.recordAttempt({ env: {} });
  }
  assert.deepEqual(store.outbox.map((row) => row.rule), ["attempts_10m"]);

  await telemetry.recordAttempt({ env: {} });
  assert.deepEqual(store.outbox.map((row) => row.rule), [
    "attempts_10m",
    "attempts_24h",
  ]);
});

test("concurrent threshold crossings enqueue one alert", async () => {
  const store = memoryStore();
  const telemetry = createAlertTelemetry({
    store,
    now: () => 1_800_000_000_000,
    randomUuid: uuidSequence(),
  });

  await Promise.all(
    Array.from({ length: 100 }, () => telemetry.recordAttempt({ env: {} })),
  );
  assert.deepEqual(
    store.outbox.filter((row) => row.rule === "attempts_10m").map((row) => row.rule),
    ["attempts_10m"],
  );
});

test("ten-minute alert windows exclude the expired minute bucket", async () => {
  const store = memoryStore();
  const baseMs = 1_800_000_000_000;
  let nowMs = baseMs - 10 * 60 * 1_000;
  const telemetry = createAlertTelemetry({
    store,
    now: () => nowMs,
    randomUuid: uuidSequence(),
  });

  for (let count = 0; count < 99; count += 1) {
    await telemetry.recordAttempt({ env: {} });
  }
  nowMs = baseMs;
  await telemetry.recordAttempt({ env: {} });
  assert.equal(store.outbox.length, 0);

  for (let count = 1; count < 100; count += 1) {
    await telemetry.recordAttempt({ env: {} });
  }
  assert.equal(
    store.outbox.filter((row) => row.rule === "attempts_10m").length,
    1,
  );
});

test("accepted and coarse upstream failures use their exact thresholds", async () => {
  const store = memoryStore();
  const telemetry = createAlertTelemetry({
    store,
    now: () => 1_800_000_000_000,
    randomUuid: uuidSequence(),
  });

  for (let count = 0; count < 49; count += 1) {
    await telemetry.recordAccepted({ env: {} });
  }
  assert.equal(store.outbox.length, 0);
  await telemetry.recordAccepted({ env: {} });
  assert.equal(store.outbox[0].rule, "accepted_24h");

  await telemetry.recordFailure({ env: {}, category: "turnstile" });
  await telemetry.recordFailure({ env: {}, category: "turnstile" });
  assert.equal(store.outbox.length, 1);
  await telemetry.recordFailure({ env: {}, category: "turnstile" });
  assert.equal(store.outbox[1].rule, "turnstile_upstream");

  assert.throws(
    () => telemetry.recordFailure({ env: {}, category: "raw_error_message" }),
    /Unknown coarse upstream failure category/,
  );
});

test("cooldowns suppress repeats and permit a later reminder", async () => {
  const store = memoryStore();
  let nowMs = 1_800_000_000_000;
  const telemetry = createAlertTelemetry({
    store,
    now: () => nowMs,
    randomUuid: uuidSequence(),
  });

  for (let count = 0; count < 100; count += 1) {
    await telemetry.recordAttempt({ env: {} });
  }
  assert.equal(store.outbox.length, 1);
  await telemetry.recordAttempt({ env: {} });
  assert.equal(store.outbox.length, 1);

  nowMs += 60 * 60 * 1_000;
  for (let count = 0; count < 100; count += 1) {
    await telemetry.recordAttempt({ env: {} });
  }
  assert.equal(store.outbox.filter((row) => row.rule === "attempts_10m").length, 2);
});

test("cleanup uses bounded aggregate, request, and delivered-alert retention", async () => {
  const store = memoryStore();
  const nowSeconds = 1_800_000_000;
  const telemetry = createAlertTelemetry({
    store,
    now: () => nowSeconds * 1_000,
    randomUuid: uuidSequence(),
  });

  await telemetry.cleanup({ env: { marker: "staging" } });
  assert.deepEqual(store.cleanupCalls, [
    {
      env: { marker: "staging" },
      metricBefore: nowSeconds - ALERT_RETENTION_SECONDS.metric,
      requestBefore: nowSeconds - ALERT_RETENTION_SECONDS.request,
      outboxBefore: nowSeconds - ALERT_RETENTION_SECONDS.outbox,
      staleOutboxBefore:
        nowSeconds - ALERT_RETENTION_SECONDS.staleOutbox,
    },
  ]);
});

test("queued alerts contain aggregate fields only", async () => {
  const store = memoryStore();
  const telemetry = createAlertTelemetry({
    store,
    now: () => 1_800_000_000_000,
    randomUuid: uuidSequence(),
  });
  for (let count = 0; count < 50; count += 1) {
    await telemetry.recordAccepted({ env: {} });
  }

  assert.deepEqual(Object.keys(store.outbox[0]).sort(), [
    "alertId",
    "count",
    "rule",
    "threshold",
    "windowSeconds",
  ]);
  const serialized = JSON.stringify(store.outbox);
  for (const forbidden of ["email", "name", "payload", "sourceIp", "token", "rawError"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});
