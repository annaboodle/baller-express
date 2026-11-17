# Stage 2 staging owner notifications

This is an owner-only Google Apps Script for the private Stage 2 staging
workbook. It is not deployed automatically and must never be attached to the
production workbook during feature development.

It performs two independent jobs every five minutes:

1. It emails the owner about private edit-proposal rows, then updates only
   `notification_status` (column M) and `notified_at` (column N).
2. It leases aggregate, PII-free usage/failure alerts from the staging Worker,
   emails the owner, and acknowledges or retries them.

It also sends an independent owner-side outage alert after three consecutive
Worker polling failures, so a D1 or Worker outage does not have to report
itself.

## Required Script Properties

Set these in the Apps Script project's **Project Settings**. Do not put their
values in source control.

- `OWNER_EMAIL`
- `STAGING_SPREADSHEET_ID`
- `STAGING_WORKER_URL` -- the HTTPS staging origin with no trailing slash
- `ALERT_POLL_SECRET` -- the same 32+ character value stored as a Worker secret

After setting them, manually run
`validateBallerExpressStage2Configuration()`. Then run
`setupBallerExpressStage2Trigger()` to create one five-minute trigger. Google
will ask the owner to authorize access to the staging Sheet, outbound HTTPS,
and email.

Keep Google Apps Script's own trigger-failure notifications enabled as a
secondary monitor. The script reserves ten daily MailApp messages so proposal
mail cannot silently consume the entire owner-alert allowance.

## Privacy and failure behavior

- Proposal contact details are read directly from the private Sheet and sent
  only to `OWNER_EMAIL`; they never enter D1 or the aggregate alert response.
- Script Properties retain only server-owned proposal/alert IDs, retry counts,
  timestamps, and coarse health state.
- The Worker alert API exposes aggregate rule codes and counts only and has no
  CORS headers. Every request is HMAC-signed with a five-minute replay window.
- A mail failure moves the proposal to `RETRY` and uses capped exponential
  backoff. After eight failed attempts it becomes `FAILED` for manual owner
  review; this notification status does not mean the proposal itself was
  rejected.
- An alert email is remembered locally before acknowledgement, limiting
  duplicates if email succeeds but the Worker acknowledgement fails.
- Low MailApp quota leaves work queued rather than dropping it or creating a
  paid dependency.
