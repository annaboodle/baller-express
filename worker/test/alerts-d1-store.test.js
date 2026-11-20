import assert from "node:assert/strict";
import test from "node:test";

import { createD1AlertStore } from "../src/alerts/d1-alert-store.js";

function fakeStatement(sql, handlers, calls) {
  return {
    sql,
    params: [],
    bind(...params) {
      this.params = params;
      return this;
    },
    async run() {
      calls.push({ method: "run", sql, params: this.params });
      return handlers.run?.(sql, this.params) || { meta: { changes: 1 } };
    },
    async first() {
      calls.push({ method: "first", sql, params: this.params });
      return handlers.first?.(sql, this.params) || null;
    },
    async all() {
      calls.push({ method: "all", sql, params: this.params });
      return handlers.all?.(sql, this.params) || { results: [] };
    },
  };
}

function fakeDatabase(handlers = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return fakeStatement(sql, handlers, calls);
    },
    async batch(statements) {
      calls.push({
        method: "batch",
        statements: statements.map((statement) => ({
          sql: statement.sql,
          params: statement.params,
        })),
      });
      if (handlers.batch) return handlers.batch(statements);
      return statements.map(() => ({ meta: { changes: 1 } }));
    },
  };
}

test("D1 enqueue uses one atomic state/outbox/cooldown batch", async () => {
  const db = fakeDatabase();
  const store = createD1AlertStore();
  const rule = {
    key: "attempts_10m",
    threshold: 100,
    windowSeconds: 600,
    cooldownSeconds: 3_600,
  };

  const created = await store.enqueueAlertIfEligible({
    env: { SUBMISSIONS_DB: db },
    alertId: "alert-1",
    dedupeKey: "attempts_10m:1800000000",
    rule,
    observedCount: 100,
    nowSeconds: 1_800_000_000,
  });

  assert.equal(created, true);
  const batch = db.calls.find((call) => call.method === "batch");
  assert.equal(batch.statements.length, 3);
  assert.match(batch.statements[0].sql, /INSERT OR IGNORE INTO alert_state/);
  assert.match(batch.statements[1].sql, /INSERT OR IGNORE INTO alert_outbox/);
  assert.match(batch.statements[2].sql, /UPDATE alert_state/);
  assert.deepEqual(batch.statements[1].params, [
    "alert-1",
    "attempts_10m:1800000000",
    "attempts_10m",
    100,
    100,
    600,
    1_800_000_000,
  ]);
  assert.equal(batch.statements[2].params[1], 1_800_003_600);
});

test("D1 lease reclaims expiry, conditionally leases, and reads by token", async () => {
  const db = fakeDatabase({
    all(sql) {
      if (sql.includes("SELECT alert_id\n  FROM alert_outbox")) {
        return { results: [{ alert_id: "alert-1" }] };
      }
      if (sql.includes("WHERE lease_token = ?1")) {
        return {
          results: [
            {
              alert_id: "alert-1",
              rule_key: "attempts_10m",
              lease_token: "lease-1",
            },
          ],
        };
      }
      return { results: [] };
    },
  });
  const store = createD1AlertStore();
  const rows = await store.leaseAlerts({
    env: { SUBMISSIONS_DB: db },
    nowSeconds: 1_800_000_000,
    leaseToken: "lease-1",
    leaseSeconds: 300,
    limit: 5,
  });

  assert.equal(rows[0].alert_id, "alert-1");
  const batch = db.calls.find((call) => call.method === "batch");
  assert.equal(batch.statements.length, 1);
  assert.match(batch.statements[0].sql, /state = 'leased'/);
  assert.deepEqual(batch.statements[0].params, [
    "alert-1",
    "lease-1",
    1_800_000_300,
    1_800_000_000,
  ]);
});

test("D1 acknowledgement, retry, and cleanup stay identifier-only", async () => {
  const db = fakeDatabase();
  const store = createD1AlertStore();
  const env = { SUBMISSIONS_DB: db };

  assert.equal(
    await store.acknowledge({
      env,
      alertId: "alert-1",
      leaseToken: "lease-1",
      nowSeconds: 1_800_000_000,
    }),
    true,
  );
  assert.equal(
    await store.retry({
      env,
      alertId: "alert-2",
      leaseToken: "lease-2",
      availableAt: 1_800_000_600,
      nowSeconds: 1_800_000_000,
    }),
    true,
  );
  await store.cleanup({
    env,
    metricBefore: 10,
    requestBefore: 20,
    outboxBefore: 30,
    staleOutboxBefore: 40,
  });

  const serialized = JSON.stringify(db.calls);
  assert.equal(serialized.includes("private@example.invalid"), false);
  assert.equal(serialized.includes("203.0.113.8"), false);
  const cleanupBatch = db.calls.filter((call) => call.method === "batch").at(-1);
  assert.deepEqual(
    cleanupBatch.statements.map((statement) => statement.params),
    [[10], [20], [30, 40]],
  );
});

test("D1 alert operations fail closed without the staging binding", async () => {
  const store = createD1AlertStore();
  await assert.rejects(
    store.incrementMetric({ env: {}, metric: "attempt", bucketStart: 0 }),
    /staging D1 binding is unavailable/,
  );
});
