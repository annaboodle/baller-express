import {
  FAILURE_METRIC,
  METRICS,
  rulesForMetric,
} from "./rules.js";

const MINUTE_SECONDS = 60;
const DEFAULT_METRIC_RETENTION_SECONDS = 48 * 60 * 60;
const DEFAULT_REQUEST_RETENTION_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_OUTBOX_RETENTION_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_STALE_OUTBOX_RETENTION_SECONDS = 90 * 24 * 60 * 60;

function unixSeconds(now) {
  return Math.floor(now() / 1_000);
}

function minuteBucket(seconds) {
  return Math.floor(seconds / MINUTE_SECONDS) * MINUTE_SECONDS;
}

function requireStore(store) {
  for (const method of [
    "incrementMetric",
    "sumMetric",
    "enqueueAlertIfEligible",
    "cleanup",
  ]) {
    if (typeof store?.[method] !== "function") {
      throw new Error(`Alert telemetry store is missing ${method}().`);
    }
  }
  return store;
}

function defaultUuid() {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new Error("Secure UUID generation is unavailable.");
  }
  return globalThis.crypto.randomUUID();
}

export function createAlertTelemetry({
  store,
  now = Date.now,
  randomUuid = defaultUuid,
} = {}) {
  const telemetryStore = requireStore(store);

  async function recordMetric({ env, metric }) {
    const nowSeconds = unixSeconds(now);
    const bucketStart = minuteBucket(nowSeconds);
    await telemetryStore.incrementMetric({
      env,
      metric,
      bucketStart,
    });

    const enqueued = [];
    for (const rule of rulesForMetric(metric)) {
      const earliestBucket = minuteBucket(
        nowSeconds - rule.windowSeconds + MINUTE_SECONDS,
      );
      const observedCount = await telemetryStore.sumMetric({
        env,
        metric,
        earliestBucket,
      });
      if (observedCount < rule.threshold) continue;

      const alertId = randomUuid();
      const created = await telemetryStore.enqueueAlertIfEligible({
        env,
        alertId,
        dedupeKey: `${rule.key}:${nowSeconds}`,
        rule,
        observedCount,
        nowSeconds,
      });
      if (created) enqueued.push(rule.key);
    }
    return Object.freeze({ enqueued: Object.freeze(enqueued) });
  }

  return Object.freeze({
    recordAttempt({ env }) {
      return recordMetric({ env, metric: METRICS.ATTEMPT });
    },

    recordAccepted({ env }) {
      return recordMetric({ env, metric: METRICS.ACCEPTED });
    },

    recordFailure({ env, category }) {
      const metric = FAILURE_METRIC[category];
      if (!metric) {
        throw new Error("Unknown coarse upstream failure category.");
      }
      return recordMetric({ env, metric });
    },

    cleanup({ env }) {
      const nowSeconds = unixSeconds(now);
      return telemetryStore.cleanup({
        env,
        metricBefore:
          nowSeconds - DEFAULT_METRIC_RETENTION_SECONDS,
        requestBefore:
          nowSeconds - DEFAULT_REQUEST_RETENTION_SECONDS,
        outboxBefore:
          nowSeconds - DEFAULT_OUTBOX_RETENTION_SECONDS,
        staleOutboxBefore:
          nowSeconds - DEFAULT_STALE_OUTBOX_RETENTION_SECONDS,
      });
    },
  });
}

export const ALERT_RETENTION_SECONDS = Object.freeze({
  metric: DEFAULT_METRIC_RETENTION_SECONDS,
  request: DEFAULT_REQUEST_RETENTION_SECONDS,
  outbox: DEFAULT_OUTBOX_RETENTION_SECONDS,
  staleOutbox: DEFAULT_STALE_OUTBOX_RETENTION_SECONDS,
});
