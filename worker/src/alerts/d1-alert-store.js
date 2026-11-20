const METRIC_INCREMENT = `
  INSERT INTO metric_buckets (metric, bucket_start, count)
  VALUES (?1, ?2, 1)
  ON CONFLICT(metric, bucket_start)
  DO UPDATE SET count = count + 1
`;

const METRIC_SUM = `
  SELECT COALESCE(SUM(count), 0) AS total
  FROM metric_buckets
  WHERE metric = ?1 AND bucket_start >= ?2
`;

const STATE_ENSURE = `
  INSERT OR IGNORE INTO alert_state (
    rule_key, next_eligible_at, last_count, updated_at
  ) VALUES (?1, 0, 0, ?2)
`;

const OUTBOX_ENQUEUE = `
  INSERT OR IGNORE INTO alert_outbox (
    alert_id, dedupe_key, rule_key, observed_count, threshold,
    window_seconds, first_observed_at, state, available_at, attempts,
    created_at, updated_at
  )
  SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', ?7, 0, ?7, ?7
  WHERE EXISTS (
    SELECT 1 FROM alert_state
    WHERE rule_key = ?3 AND next_eligible_at <= ?7
  )
`;

const STATE_ADVANCE = `
  UPDATE alert_state
  SET next_eligible_at = ?2, last_count = ?3, updated_at = ?4
  WHERE rule_key = ?1
    AND EXISTS (
      SELECT 1 FROM alert_outbox WHERE dedupe_key = ?5
    )
`;

const LEASE_RECLAIM = `
  UPDATE alert_outbox
  SET state = 'pending', available_at = ?1, lease_token = NULL,
      lease_expires_at = NULL, updated_at = ?1
  WHERE state = 'leased' AND lease_expires_at <= ?1
`;

const LEASE_CANDIDATES = `
  SELECT alert_id
  FROM alert_outbox
  WHERE state = 'pending' AND available_at <= ?1
  ORDER BY created_at, alert_id
  LIMIT ?2
`;

const LEASE_ONE = `
  UPDATE alert_outbox
  SET state = 'leased', attempts = attempts + 1, lease_token = ?2,
      lease_expires_at = ?3, updated_at = ?4
  WHERE alert_id = ?1 AND state = 'pending' AND available_at <= ?4
`;

const LEASE_READ = `
  SELECT alert_id, rule_key, observed_count, threshold, window_seconds,
         first_observed_at, attempts, lease_token, lease_expires_at
  FROM alert_outbox
  WHERE lease_token = ?1 AND state = 'leased'
  ORDER BY created_at, alert_id
`;

const ACK = `
  UPDATE alert_outbox
  SET state = 'delivered', delivered_at = COALESCE(delivered_at, ?3),
      lease_expires_at = NULL, updated_at = ?3
  WHERE alert_id = ?1 AND lease_token = ?2
    AND state IN ('leased', 'delivered')
`;

const NACK = `
  UPDATE alert_outbox
  SET state = 'pending', available_at = ?3, lease_token = NULL,
      lease_expires_at = NULL, updated_at = ?4
  WHERE alert_id = ?1 AND lease_token = ?2 AND state = 'leased'
`;

const CLEAN_METRICS = `DELETE FROM metric_buckets WHERE bucket_start < ?1`;
const CLEAN_REQUESTS = `DELETE FROM request_records WHERE created_at < ?1`;
const CLEAN_OUTBOX = `
  DELETE FROM alert_outbox
  WHERE (created_at < ?1 AND state = 'delivered') OR created_at < ?2
`;

function database(env) {
  const db = env?.SUBMISSIONS_DB;
  if (!db || typeof db.prepare !== "function") {
    throw new Error("The staging D1 binding is unavailable.");
  }
  return db;
}

function changes(result) {
  return Number(result?.meta?.changes || 0);
}

function rows(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

export function createD1AlertStore() {
  return Object.freeze({
    async incrementMetric({ env, metric, bucketStart }) {
      await database(env)
        .prepare(METRIC_INCREMENT)
        .bind(metric, bucketStart)
        .run();
    },

    async sumMetric({ env, metric, earliestBucket }) {
      const row = await database(env)
        .prepare(METRIC_SUM)
        .bind(metric, earliestBucket)
        .first();
      const total = Number(row?.total || 0);
      if (!Number.isInteger(total) || total < 0) {
        throw new Error("D1 returned an invalid aggregate metric count.");
      }
      return total;
    },

    async enqueueAlertIfEligible({
      env,
      alertId,
      dedupeKey,
      rule,
      observedCount,
      nowSeconds,
    }) {
      const db = database(env);
      if (typeof db.batch !== "function") {
        throw new Error("The staging D1 binding does not support atomic batches.");
      }
      const results = await db.batch([
        db.prepare(STATE_ENSURE).bind(rule.key, nowSeconds),
        db.prepare(OUTBOX_ENQUEUE).bind(
          alertId,
          dedupeKey,
          rule.key,
          observedCount,
          rule.threshold,
          rule.windowSeconds,
          nowSeconds,
        ),
        db.prepare(STATE_ADVANCE).bind(
          rule.key,
          nowSeconds + rule.cooldownSeconds,
          observedCount,
          nowSeconds,
          dedupeKey,
        ),
      ]);
      return changes(results?.[1]) === 1;
    },

    async leaseAlerts({
      env,
      nowSeconds,
      leaseToken,
      leaseSeconds,
      limit,
    }) {
      const db = database(env);
      await db.prepare(LEASE_RECLAIM).bind(nowSeconds).run();
      const candidateResult = await db
        .prepare(LEASE_CANDIDATES)
        .bind(nowSeconds, limit)
        .all();
      const candidates = rows(candidateResult);
      if (candidates.length === 0) return [];
      if (typeof db.batch !== "function") {
        throw new Error("The staging D1 binding does not support atomic batches.");
      }
      await db.batch(
        candidates.map((row) =>
          db
            .prepare(LEASE_ONE)
            .bind(
              row.alert_id,
              leaseToken,
              nowSeconds + leaseSeconds,
              nowSeconds,
            ),
        ),
      );
      const leased = await db.prepare(LEASE_READ).bind(leaseToken).all();
      return rows(leased);
    },

    async acknowledge({ env, alertId, leaseToken, nowSeconds }) {
      const result = await database(env)
        .prepare(ACK)
        .bind(alertId, leaseToken, nowSeconds)
        .run();
      return changes(result) === 1;
    },

    async retry({
      env,
      alertId,
      leaseToken,
      availableAt,
      nowSeconds,
    }) {
      const result = await database(env)
        .prepare(NACK)
        .bind(alertId, leaseToken, availableAt, nowSeconds)
        .run();
      return changes(result) === 1;
    },

    async cleanup({
      env,
      metricBefore,
      requestBefore,
      outboxBefore,
      staleOutboxBefore,
    }) {
      const db = database(env);
      if (typeof db.batch !== "function") {
        throw new Error("The staging D1 binding does not support atomic batches.");
      }
      await db.batch([
        db.prepare(CLEAN_METRICS).bind(metricBefore),
        db.prepare(CLEAN_REQUESTS).bind(requestBefore),
        db.prepare(CLEAN_OUTBOX).bind(outboxBefore, staleOutboxBefore),
      ]);
    },
  });
}
