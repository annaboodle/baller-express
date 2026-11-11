# Submission Worker foundation

This directory contains the credential-free Stage 1 foundation for the future
submission API. It is intentionally not deployable yet:

- There is no Wrangler configuration.
- There are no Cloudflare, Turnstile, D1, or Google credentials or bindings.
- The default adapters fail closed.
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

Stage 2 will implement those interfaces with isolated staging resources. The
repository adapter will own idempotency, short-window deduplication, and the
Sheets write boundary so a request is not reported as accepted before durable
storage succeeds. It must apply the supplied server-owned fields, generate IDs
and timestamps server-side, write user values as literals, and return a complete
sanitized public event for a milestone. Adapter implementations must not log
payloads, tokens, email addresses, or raw IPs.
