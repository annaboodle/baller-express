const RATE_UPSERT = `
  INSERT INTO rate_limit_windows (bucket_key, bucket_start, count)
  VALUES (?1, ?2, 1)
  ON CONFLICT(bucket_key, bucket_start)
  DO UPDATE SET count = count + 1
  RETURNING count
`;

const RATE_CLEANUP = `
  DELETE FROM rate_limit_windows WHERE bucket_start < ?1
`;

const REQUEST_SELECT = `
  SELECT request_id, endpoint, payload_hash, state, submission_id, sheet_name,
         dedupe_key, public_response_json, created_at, completed_at
  FROM request_records
  WHERE request_id = ?1
  LIMIT 1
`;

const REQUEST_INSERT = `
  INSERT OR IGNORE INTO request_records (
    request_id, endpoint, payload_hash, state, submission_id, sheet_name,
    dedupe_key, public_response_json, created_at
  ) VALUES (?1, ?2, ?3, 'pending', ?4, ?5, ?6, ?7, ?8)
`;

const REQUEST_COMPLETE = `
  UPDATE request_records
  SET state = 'created', completed_at = ?2
  WHERE request_id = ?1 AND state = 'pending'
`;

const REQUEST_DELETE_PENDING = `
  DELETE FROM request_records WHERE request_id = ?1 AND state = 'pending'
`;

const DEDUPE_ACQUIRE = `
  INSERT INTO dedupe_locks (dedupe_key, request_id, expires_at)
  VALUES (?1, ?2, ?3)
  ON CONFLICT(dedupe_key) DO UPDATE SET
    request_id = excluded.request_id,
    expires_at = excluded.expires_at
  WHERE dedupe_locks.expires_at <= ?4
  RETURNING request_id
`;

const DEDUPE_RELEASE = `
  DELETE FROM dedupe_locks WHERE dedupe_key = ?1 AND request_id = ?2
`;

const DEDUPE_CLEANUP = `
  DELETE FROM dedupe_locks WHERE expires_at <= ?1
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

export function createD1Store() {
  return Object.freeze({
    async incrementRateWindow({
      env,
      bucketKey,
      bucketStart,
      expiresBefore,
    }) {
      const db = database(env);
      const row = await db
        .prepare(RATE_UPSERT)
        .bind(bucketKey, bucketStart)
        .first();
      if (!row || !Number.isInteger(Number(row.count))) {
        throw new Error("D1 did not return a rate-limit count.");
      }

      // Cleanup is best-effort. A cleanup failure must not erase the valid,
      // atomic count that protects this request.
      try {
        await db.prepare(RATE_CLEANUP).bind(expiresBefore).run();
      } catch {
        // A later request can retry cleanup without exposing request data.
      }
      return Number(row.count);
    },

    async getRequest({ env, requestId }) {
      return database(env).prepare(REQUEST_SELECT).bind(requestId).first();
    },

    async reserveRequest({ env, record }) {
      const result = await database(env)
        .prepare(REQUEST_INSERT)
        .bind(
          record.requestId,
          record.endpoint,
          record.payloadHash,
          record.submissionId,
          record.sheetName,
          record.dedupeKey,
          record.publicResponseJson,
          record.createdAt,
        )
        .run();
      return changes(result) === 1;
    },

    async completeRequest({ env, requestId, completedAt }) {
      const result = await database(env)
        .prepare(REQUEST_COMPLETE)
        .bind(requestId, completedAt)
        .run();
      return changes(result) === 1;
    },

    async deletePendingRequest({ env, requestId }) {
      await database(env)
        .prepare(REQUEST_DELETE_PENDING)
        .bind(requestId)
        .run();
    },

    async acquireDedupe({
      env,
      dedupeKey,
      requestId,
      expiresAt,
      nowSeconds,
    }) {
      const row = await database(env)
        .prepare(DEDUPE_ACQUIRE)
        .bind(dedupeKey, requestId, expiresAt, nowSeconds)
        .first();
      try {
        await database(env)
          .prepare(DEDUPE_CLEANUP)
          .bind(nowSeconds)
          .run();
      } catch {
        // Expired keyed fingerprints contain no request data and can be
        // cleaned by a later request.
      }
      return row?.request_id || null;
    },

    async releaseDedupe({ env, dedupeKey, requestId }) {
      await database(env)
        .prepare(DEDUPE_RELEASE)
        .bind(dedupeKey, requestId)
        .run();
    },
  });
}
