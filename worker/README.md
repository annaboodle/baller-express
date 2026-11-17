# Submission Worker

This directory contains the submission API and its staging-only Stage 2
adapters. It still contains no real credential, resource ID, route, or
production binding:

- `wrangler.staging.example.jsonc` is a non-deployable template whose D1 ID must
  be replaced in an ignored copy before staging use.
- `.dev.vars.example` lists required secret names using placeholders only.
- The runtime fails closed when a binding, secret, or safety setting is absent.
- `SUBMISSIONS_ENABLED` must be exactly `true` before a request can proceed.

Run the local checks with Node.js 20 or newer:

```sh
npm ci
npm run check
npm test
```

## Adapter boundary

`createSubmissionApp` receives three adapters:

- `rateLimiter.check(context)` receives the endpoint and source IP and returns
  `{ allowed, retryAfterSeconds? }`. Its staging implementation must derive a
  secret keyed value and must not store or log the raw IP.
- `turnstile.verify(context)` receives the token, expected action, expected
  hostname, and source IP and returns `{ success }`. A successful result means
  all of those checks passed server-side.
- `repository.findReplay(context)` runs before Turnstile so a retry can return
  its stored result without reusing a single-use token. It must compare both the
  request ID and normalized-payload fingerprint and return `null`, a valid
  `{ kind: "replay", ... }`, or `{ kind: "conflict" }`.
- `repository.createMilestone(context)` and
  `repository.createEditProposal(context)` run only after verification and
  return `{ kind: "created", ... }`, `{ kind: "replay", ... }`,
  `{ kind: "duplicate" }`, or `{ kind: "conflict" }`.

Stage 2 implements those interfaces with isolated staging resources:

- `createD1RateLimiter` stores only a secret-keyed source fingerprint in fixed
  windows. It never stores a raw IP.
- `createTurnstileVerifier` checks the server response, action, and hostname.
- `createD1SheetsRepository` reserves request IDs in D1, applies an atomic
  short-window deduplication lock, writes through the Sheets API using
  `valueInputOption=RAW`, and records only public replay data in D1. The
  content fingerprint excludes request IDs, single-use Turnstile tokens, and
  optional contributor contact details.
- A pending D1 record can reconcile a successful Sheets append by looking up
  its server-generated submission ID before any retry writes another row.
- Turnstile, Google OAuth, and Sheets requests use bounded timeouts and fail
  closed. Sheets writes first verify the exact header contract and use
  `insertDataOption=OVERWRITE` so the protected spill formulas are not
  displaced.
- `createAlertTelemetry` stores only aggregate one-minute counters and coarse
  upstream categories. Threshold crossings enter a durable D1 outbox with
  cooldowns; telemetry failure after a successful Sheet write never reverses
  the public success response.
- `/internal/v1/alerts/lease`, `/ack`, and `/nack` have no CORS access and
  require a fresh HMAC signature. Their responses contain aggregate rule/count
  data and server-owned identifiers only.

The Worker writes exactly `Timeline Source!A:M`; column N (`publish_rank`) is
owned by the generated workbook formula. The complete private source schema is
`event_id`, `date`, `precise`, `event`, `people`, `type`, `size`, `hide`,
`source`, `submitted_at`, `submission_id`, `contributor_name`,
`contributor_email`, `publish_rank`.

The Worker writes exactly `Edit Proposals!A:M` using this prefix:
`proposal_id`, `submission_id`, `source`, `submitted_at`,
`original_event_id`, `original_date`, `original_description`,
`original_people`, `fields`, `requested_change`, `contributor_name`,
`contributor_email`, `notification_status`. It initializes
`notification_status` to `PENDING`. Notification and review processes own the
remaining `notified_at`, `review_status`, `reviewed_at`, and `reviewer_notes`
columns N:Q. An edit proposal must reference an existing immutable event ID;
the Worker still generates every new canonical event ID itself. Individual
people names cannot contain commas because the private Sheet uses a reversible
comma-separated representation.

## Free owner notifications and alerts

`apps-script/Code.gs` and its least-privilege `apps-script/appsscript.json`
manifest are installed manually in the owner-bound staging workbook only. The
manifest restricts Sheet access to that current workbook. Every five minutes
the script:

1. emails the owner about `PENDING`/`RETRY` edit proposals and updates M:N;
2. leases aggregate alerts from the Worker, sends them, and ACKs or retries;
3. reports three consecutive Worker/D1 polling failures independently and
   sends one recovery message later.

It reserves ten MailApp recipients per day and leaves work queued when quota is
low. Proposal failures use capped backoff and become `FAILED` for manual review
after eight attempts. See `apps-script/README.md` for Script Properties and the
manual trigger setup.

Configured alert rules are:

- 100 attempts in 10 minutes (one-hour cooldown)
- 1,000 attempts in 24 hours (24-hour cooldown)
- 50 newly created submissions in 24 hours (24-hour cooldown)
- three Turnstile, Sheets, or Google-auth upstream failures in 10 minutes
  (one-hour cooldown)

Replays, conflicts, and duplicates do not count as accepted submissions. A
normal unsuccessful Turnstile challenge is an attempt, not an upstream failure.

## Configuration contract

Tracked plain staging variables live in the ignored Wrangler copy:

- `ALLOWED_ORIGIN`
- `SUBMISSIONS_ENABLED` (must be exactly `true` to enable public writes)
- `RATE_LIMIT_WINDOW_SECONDS`
- `RATE_LIMIT_MAX_ATTEMPTS`
- `RATE_LIMIT_RETENTION_SECONDS`
- `DEDUPE_WINDOW_SECONDS`
- `PENDING_STALE_SECONDS`

Secrets/private identifiers are set through Wrangler secrets or ignored local
`.dev.vars`; never commit their values:

- `TURNSTILE_SECRET_KEY`
- `RATE_LIMIT_SECRET`
- `REQUEST_HASH_SECRET`
- `ALERT_POLL_SECRET`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `GOOGLE_SHEETS_SPREADSHEET_ID`

The three keyed secrets must be independent and contain at least 32 random
characters. The staging Google service account may access only the staging
workbook. The Wrangler configuration declares exactly these seven names as
required so local development ignores unrelated entries and deployment fails
closed if any required secret is absent.

To import a downloaded staging service-account JSON key without printing its
contents, run `scripts/import-google-service-account.mjs` with `--input`,
`--project`, and `--service-account`. The importer verifies the exact staging
identity and PKCS#8 key, refuses to overwrite existing Google credentials, and
writes the ignored `.dev.vars` atomically with owner-only permissions. Delete
the downloaded JSON after the import and a no-secret authentication check.

Run `scripts/generate-staging-keyed-secrets.mjs` to generate any missing
`RATE_LIMIT_SECRET`, `REQUEST_HASH_SECRET`, and `ALERT_POLL_SECRET` values. It
never prints or replaces a value, requires independent secrets of at least 32
characters, and preserves owner-only permissions on `.dev.vars`.

Before a staging deploy, run `scripts/prepare-staging-deploy-secrets.mjs`. It
creates an owner-only, ignored `local-secrets/staging-deploy.env` containing
exactly the seven required server secrets and excludes the public Turnstile
site key. Wrangler can consume that filtered file with `--secrets-file`; delete
the exact temporary file immediately after the deploy attempt.

## Staging provisioning boundary

Do not deploy the example configuration. For an isolated staging setup:

1. Create a free D1 staging database and copy the example Wrangler file to an
   ignored staging configuration with the returned ID.
2. Apply `migrations/0001_stage2.sql` to staging only.
3. Share only the staging workbook with a staging-only Google service account.
4. Add the listed values as Worker secrets or ignored local variables.
5. Install the owner Apps Script and its Script Properties only after the
   staging Worker URL and shared HMAC secret exist.
6. Keep `SUBMISSIONS_ENABLED=false` until the staging workbook, dedicated
   staging Turnstile widget, D1 binding, notifications, and alerts have all
   been verified. Use a real staging widget for end-to-end tests: Cloudflare's
   [dummy success response](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)
   cannot satisfy strict hostname/action validation.

The ignored filename is `wrangler.staging.jsonc`. The example intentionally
cannot deploy until its D1 placeholder is replaced. Confirm the Cloudflare
account is still Workers Free and the Google project has no billing account
before any provisioning or deployment command.

There is deliberately no custom domain, production route, production Sheet ID,
or deployment command in this repository yet.
