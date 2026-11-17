PRAGMA foreign_keys = ON;

-- These tables store keyed fingerprints and server-owned identifiers. A
-- completed milestone also retains the same seven public timeline fields
-- needed for an idempotent replay. Raw IP addresses, Turnstile tokens,
-- contributor contact details, and private edit-proposal text must never be
-- written to D1.
CREATE TABLE rate_limit_windows (
  bucket_key TEXT NOT NULL,
  bucket_start INTEGER NOT NULL,
  count INTEGER NOT NULL CHECK (count > 0),
  PRIMARY KEY (bucket_key, bucket_start)
);

CREATE TABLE dedupe_locks (
  dedupe_key TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE request_records (
  request_id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL CHECK (
    endpoint IN ('/v1/milestones', '/v1/edit-proposals')
  ),
  payload_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'created')),
  submission_id TEXT NOT NULL UNIQUE,
  sheet_name TEXT NOT NULL CHECK (
    sheet_name IN ('Timeline Source', 'Edit Proposals')
  ),
  dedupe_key TEXT NOT NULL,
  public_response_json TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX request_records_payload_idx
  ON request_records (endpoint, payload_hash, created_at);

CREATE INDEX request_records_created_idx
  ON request_records (created_at);

-- Aggregate operational telemetry. Metric names are intentionally enumerated
-- so this table cannot become a generic payload or error log.
CREATE TABLE metric_buckets (
  metric TEXT NOT NULL CHECK (
    metric IN (
      'attempt',
      'accepted',
      'failure_turnstile',
      'failure_sheets',
      'failure_google_auth'
    )
  ),
  bucket_start INTEGER NOT NULL,
  count INTEGER NOT NULL CHECK (count > 0),
  PRIMARY KEY (metric, bucket_start)
);

CREATE INDEX metric_buckets_start_idx
  ON metric_buckets (bucket_start);

CREATE TABLE alert_state (
  rule_key TEXT PRIMARY KEY CHECK (
    rule_key IN (
      'attempts_10m',
      'attempts_24h',
      'accepted_24h',
      'turnstile_upstream',
      'sheets_upstream',
      'google_auth'
    )
  ),
  next_eligible_at INTEGER NOT NULL DEFAULT 0,
  last_count INTEGER NOT NULL DEFAULT 0 CHECK (last_count >= 0),
  updated_at INTEGER NOT NULL
);

-- Durable, aggregate-only mail queue. It must never contain a submission
-- payload, contact details, an IP address, a token, or a raw error string.
CREATE TABLE alert_outbox (
  alert_id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  rule_key TEXT NOT NULL CHECK (
    rule_key IN (
      'attempts_10m',
      'attempts_24h',
      'accepted_24h',
      'turnstile_upstream',
      'sheets_upstream',
      'google_auth'
    )
  ),
  observed_count INTEGER NOT NULL CHECK (observed_count >= 0),
  threshold INTEGER NOT NULL CHECK (threshold > 0),
  window_seconds INTEGER NOT NULL CHECK (window_seconds > 0),
  first_observed_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'leased', 'delivered')),
  available_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_token TEXT,
  lease_expires_at INTEGER,
  delivered_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX alert_outbox_ready_idx
  ON alert_outbox (state, available_at, lease_expires_at);

CREATE INDEX alert_outbox_created_idx
  ON alert_outbox (created_at);
