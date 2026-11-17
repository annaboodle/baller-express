# Submission security and deployment runbook

Status: Stage 1 complete; Stage 2 isolated staging implementation in progress

Last reviewed: 2026-11-16

## Production safety rule

The current website must remain unchanged throughout development and local
review. Do not modify the current production Forms, published spreadsheets,
GitHub Pages source, or `gh-pages` branch until the final cutover checklist is
explicitly approved.

Verified repository state on 2026-11-09:

- GitHub Pages uses the root of `gh-pages` with the legacy branch deployment.
- `master` contains source and does not deploy automatically.
- Production `master` has no GitHub Actions workflow. Stage 1 adds a
  non-deploying pull-request workflow on the feature branch only.
- `npm run deploy` is the only repository-provided production deployment path.

## Current and target data flow

Current production:

```text
Master spreadsheet CSV -----------+
                                  +--> React merges, filters, and sorts
Form response spreadsheet CSV ----+

React forms --> public Google Forms endpoints --> response spreadsheets
```

Proposed target:

```text
React form + Turnstile token
            |
            v
Cloudflare Worker -- verify / validate / limit / deduplicate
            |
            v
Timeline Source (private)
            |
            v
Published Timeline (Generated) -- only published CSV --> React

Edit form --> Worker --> Edit Proposals (private) --> owner email
```

## Target workbook

### Timeline Source

Private canonical timeline. Its exact positional contract is A:N:

| Column | Field | Owner |
| --- | --- | --- |
| A | `event_id` | Worker/owner-generated |
| B | `date` | ISO `YYYY-MM-DD` text |
| C | `precise` | `Y` or `N` |
| D | `event` | validated literal text |
| E | `people` | validated comma-separated names |
| F | `type` | validated milestone type |
| G | `size` | Worker default `m` for submissions |
| H | `hide` | Worker default `N`, then owner-controlled |
| I | `source` | Worker/owner-controlled |
| J | `submitted_at` | numeric Google Sheets UTC timestamp |
| K | `submission_id` | Worker-generated |
| L | `contributor_name` | optional private value |
| M | `contributor_email` | optional private value |
| N | `publish_rank` | generated Sheet formula |

The Worker appends exactly A:M using `valueInputOption=RAW` and never writes
column N. Individual names cannot contain commas, making the stored people list
reversible. Cell N2 owns a single open-ended spill formula, so a newly appended
row receives a rank without relying on a fixed prefilled range.

For a valid new milestone, the Worker appends one row with the owner-controlled
default `hide=N`. It never accepts `hide` from the browser. The row therefore
flows into the generated public tab immediately and can be hidden later by the
owner if needed.

Historical master events use a source such as `legacy_master` and may have blank
submission/contact metadata. Migrated legitimate form events use
`legacy_submission`. A row from the old add-milestone response sheet is not
migrated when its legacy `hide` value is `Y`; hidden master rows remain a
separate migration decision.

### Published Timeline (Generated)

Generated projection of visible rows from `Timeline Source`. Publish only this
tab and protect it from every editor except the spreadsheet owner. The website
reads only its CSV.

Expected public fields are `event_id`, `date`, `precise`, `event`, `people`,
`type`, and `size`. Do not include contributor contact data or submission
metadata. Cell A2 owns one open-ended `FILTER` projection; the remaining public
cells are generated spill results rather than independently editable formulas.

### Edit Proposals

Private queue with the exact A:Q contract:

`proposal_id`, `submission_id`, `source`, `submitted_at`,
`original_event_id`, `original_date`, `original_description`,
`original_people`, `fields`, `requested_change`, `contributor_name`,
`contributor_email`, `notification_status`, `notified_at`, `review_status`,
`reviewed_at`, `reviewer_notes`.

The Worker appends A:M and initializes `notification_status=PENDING`. The
owner-side notification and review process owns N:Q. Notification status may be
`PENDING`, `RETRY`, `SENT`, `FAILED`, or `SKIPPED`; review status is independent.
Every proposal must include the immutable `event_id` of its existing target so
date/description/people snapshots are never used as identity.

### Staging workbook hardening

Completed on the isolated staging workbook:

- Spreadsheet timezone is `Etc/UTC`.
- Only the owner currently has Drive permission; the workbook is not published.
- The whole `Published Timeline (Generated)` tab is protected.
- `Timeline Source!N:N` is protected because it is formula-owned.
- The source rank and public projection are open-ended spill formulas, avoiding
  a silent publication limit when the Sheet grows beyond its initial row count.
- `Edit Proposals!N:Q` is protected because those columns are owner-controlled.
- Formula scans, native-Sheet export inspection, and renders of all three tabs
  pass. The hidden fixture is absent from the generated tab, the formula-like
  fixture remains literal text, and the generated tab contains only seven
  public columns.

After provisioning, share this workbook with exactly one staging-only Google
service account. That account must have no access to either production
spreadsheet. Do not publish the generated tab until the signed-out privacy test
is ready; publishing is not required for Worker storage tests.

## Development isolation

All implementation work occurs on `codex/protected-submissions`.

Local development uses:

- Frontend at `http://localhost:3000`.
- Worker at `http://localhost:8787`.
- A dedicated free staging Turnstile widget that allows `localhost`; Cloudflare
  dummy keys cannot prove this Worker's required hostname and action checks.
- A separate staging workbook containing test or sanitized fixture data.
- Development-only environment files that are ignored by Git.

No local or staging configuration may reference writable production resources.
The production Worker and workbook may be provisioned before cutover, but the
current site must not point to them until the approved production deployment.

## Approval model and staged rollout

Approve the reconciled architecture once, then authorize implementation one
stage at a time. Completing a stage does not authorize the next stage. Any
account creation, credential handling, production-data write, deployment, or
shutdown of the old Forms requires the applicable later-stage approval.

### Stage 0: safety and plan reconciliation

- Completed: create `codex/protected-submissions`, add project memory and this
  runbook, and activate the `Protect master` GitHub ruleset.
- Reconcile the older Codex plan with the agreed three-tab workbook and the
  stage gates in this runbook.
- Completed: resolve the new-milestone publication decision below.
- Gate: owner explicitly approves the reconciled architecture and authorizes
  Stage 1 only.

### Stage 1: local baseline and safety scaffolding

**Completed 2026-11-11.** Verified locally and on GitHub:

- The existing app compiles, serves HTTP 200 locally, and is documented in
  `docs/baseline.md`.
- Four frontend baseline tests replace the stale starter assertion.
- The credential-free Worker foundation fails closed and passes 23 unit tests.
- Read-only pull-request CI contains no secrets, writes, or deployment steps.
- `npm run check` passes frontend tests/build and Worker checks/tests.
- The owner reviewed the running local frontend and confirmed it looked correct.
- Draft pull request [#5](https://github.com/annaboodle/baller-express/pull/5)
  left `master` and `gh-pages` untouched, and its first real CI run passed all
  three jobs: `Frontend tests`, `Frontend production build`, and `Worker tests
  and checks`.
- The owner enabled those exact three jobs as required status checks and
  enabled the strict up-to-date-branch policy on `Protect master`. The saved
  ruleset was verified after the change.

### Stage 2: isolated staging backend and workbook

In progress as of 2026-11-16.

Completed locally or in the private staging workbook:

- Created and hardened the three-tab native staging workbook with fictional
  fixtures only.
- Created the free staging D1 database `baller-submissions-staging`, applied
  `0001_stage2.sql`, and verified the six application tables plus Wrangler's
  migration ledger. Cloudflare also exposes its internal `_cf_KV` table.
- Created the free Turnstile widget **Baller Express Submissions - Staging** in
  Managed mode, world region, with pre-clearance disabled and only `localhost`
  allowed. Its keys remain in the ignored, owner-readable local secrets file.
- Implemented fail-closed Turnstile, D1 rate limiting/idempotency/deduplication,
  exact Sheets schemas, RAW writes, partial-commit reconciliation, timeouts,
  safe public responses, and the emergency switch.
- Implemented aggregate-only D1 telemetry, alert cooldown/outbox/lease state,
  HMAC-authenticated internal alert endpoints, retention cleanup, and an
  owner-only Apps Script poller. D1 retains keyed fingerprints, server-owned
  IDs, and a new milestone's seven already-public fields for safe replay; no
  contributor contact, private edit-proposal text, raw IP, token, or raw error
  string enters D1 or an aggregate alert response.
- Verified 64 Worker tests, the SQL migration, workbook formulas, private/public
  projection, and exported-native workbook renders.

Pending owner-guided staging setup and real-provider tests:

- Finish the staging Worker setup and create a no-billing Google project.
- Share only the staging workbook with a staging-only service account.
- Deploy the Worker to `workers.dev` with no custom or production route.
- Install/authorize the Apps Script, run storage/privacy/security/notification
  tests, trigger a real high-usage alert, and exercise the kill switch.

Do not assume a Sheets API write invokes a Google Form or `onEdit` trigger. The
time-driven Apps Script poller is the explicit notification mechanism.

- Gate: privacy, storage, security, notification, and high-usage-alert tests
  pass without publishing PII or touching production data.

#### Stage 2 owner walkthrough

Work through this together with the owner; stop at any screen that asks for a
paid plan, pay-as-you-go enrollment, a billing account, a production resource,
or broader sharing than listed here.

1. In Cloudflare, confirm the account is on **Workers Free**. Do not upgrade.
2. Create one staging D1 database named `baller-submissions-staging`. Copy
   `worker/wrangler.staging.example.jsonc` to the ignored
   `worker/wrangler.staging.jsonc`, then replace only its staging D1 placeholder.
3. From `worker/`, apply `migrations/0001_stage2.sql` to that remote staging
   database with the database name, `--remote`, and the explicit ignored
   staging config. On 2026-11-16 this used Wrangler 4.158.0 because the local
   Node.js 22.6.0 runtime does not meet newer Wrangler releases' Node 22.12.0
   requirement. Verify the six application tables and `d1_migrations`;
   Cloudflare's internal `_cf_KV` table may also be visible.
4. Create one free staging-only Turnstile widget named **Baller Express
   Submissions - Staging**, in Managed mode and world region, with
   pre-clearance disabled and only `localhost` allowed. On 2026-11-16 the
   dashboard stalled twice without creating a resource; the authenticated
   Wrangler 4.158.0 CLI verified that no duplicate existed and created it
   successfully. Keep its secret only in ignored local secret storage. Use
   this real staging widget for end-to-end tests: Cloudflare's dummy success
   response always uses `example.com` and omits the action, so dummy keys cannot
   pass the Worker's strict hostname/action checks. See Cloudflare's official
   [testing behavior](https://developers.cloudflare.com/turnstile/troubleshooting/testing/).
5. In Google Cloud, create a dedicated staging project with **no billing account
   attached**, enable only the Google Sheets API, and create one staging-only
   service account and key.
6. Share only **Baller Express — Stage 2 Staging** with that service account as
   an editor. Confirm the two production spreadsheets are not shared with it.
7. Store the Turnstile secret, three independent keyed secrets, Google service
   account email/private key, and staging spreadsheet ID through Wrangler
   secrets. Never paste them into tracked files, documentation, or chat.
8. Keep `SUBMISSIONS_ENABLED=false`; deploy only to the staging `workers.dev`
   hostname with no custom route.
9. In the staging workbook's owner-bound Apps Script project, install
   `worker/apps-script/Code.gs`. Set the four Script Properties documented in
   `worker/apps-script/README.md`, validate configuration, authorize the minimum
   Sheet/HTTPS/mail scopes, and install its single five-minute trigger.
10. With the switch still off, prove public submission routes return the safe
    unavailable response, do not write Sheets, and do not record usage.
11. Enable the switch briefly and run fictional milestone/edit-proposal smoke
    tests. Verify exact A:M writes, the retained `publish_rank` formula, one
    generated public row, private contact isolation, and owner email delivery.
12. Test replay, request-ID conflict, contact-independent duplicate detection,
    the observed three-request bot burst, wrong-origin and malformed requests,
    schema drift, upstream timeouts, and formula-like literal text.
13. Trigger and receive one real 100-attempt/10-minute aggregate alert. Verify
    no contributor contact, private edit-proposal text, raw IP, token, or raw
    error string appears in D1, Worker logs, the aggregate alert API, Script
    Properties, or the aggregate alert email. Test the owner-side
    outage/recovery path separately.
14. Exercise the kill switch while staging is enabled and confirm new attempts
    fail before rate limiting, Turnstile, Sheets, or telemetry. Leave staging
    disabled after testing.
15. Record resource names, non-secret settings, test results, and teardown/key
    rotation steps here. Stage 3 remains unauthorized until the Stage 2 gate is
    explicitly accepted.

### Stage 3: local frontend integration

- Replace direct Google Form posts in the feature branch with the staging API.
- Conditionally mount the forms, add Turnstile, validation, loading/error
  states, retry-safe request IDs, and immediate milestone-publication UX.
- Gate: owner reviews desktop and mobile behavior locally; production still
  uses the old frontend and endpoints.

### Stage 4: migration rehearsal

- Export backups and run a dry-run consolidation into staging.
- Report source counts, generated IDs, master hidden rows, excluded legacy
  add-milestone rows with `hide=Y`, excluded `05/31/1970` spam, legitimate
  legacy submissions, and the exact public schema.
- Gate: owner explicitly approves the migration report before any production
  workbook is populated.

### Stage 5: production infrastructure, still dark

- Create the production workbook, Worker, Turnstile configuration, secrets,
  notification/alerting mechanism, and manual-only deployment workflow.
- Test the production Worker directly while the live site still uses its old
  Google Forms and feeds.
- Configure the GitHub production environment and deployment approval with the
  owner.
- Gate: owner explicitly approves cutover. No merge or production frontend
  deployment is implied by this stage.

### Stage 6: controlled cutover

- Merge the protected pull request; merging still must not deploy.
- Record rollback SHAs, manually deploy with approval, and run production smoke
  tests.
- Only after successful smoke tests and a final owner confirmation, close the
  old Forms and unpublish the old PII-bearing feeds.
- Gate: verify monitoring and rollback, then update documentation from proposed
  behavior to deployed current behavior.

## Resolved product decision: immediate milestone publication

On 2026-11-09, the owner chose to preserve immediate publication for new
milestones. After Turnstile verification, server validation, rate limiting,
deduplication, and a successful Sheets write, the submitter sees the milestone
optimistically and the generated public tab includes the single canonical row.
Other visitors see it after Google's published-feed refresh and a page load or
refresh. This is intentionally the same class of delay as production today;
Google documents that automatic published-Sheet updates can take a few minutes.

This deliberately accepts a residual risk: a human or sufficiently capable bot
that passes all controls can publish a milestone until the owner sets `hide=Y`.
Usage alerts, the emergency submission kill switch, and the owner-controlled
hide field limit that risk. Edit proposals remain private and manually reviewed.

## GitHub settings: do now

**Completed 2026-11-09 and extended 2026-11-11:** the active ruleset **Protect
master** applies to one target, `master`. Its bypass list is empty. It restricts
deletion, requires a pull request with zero required approvals and conversation
resolution, blocks force pushes, and now requires the three proven CI jobs with
the up-to-date-branch policy enabled.

Protect `master` without changing any Pages or deployment settings. The
repository UI observed on 2026-11-09 is **Rulesets / New branch ruleset**:

1. Set **Ruleset Name** to `Protect master`.
2. Change **Enforcement status** from **Disabled** to **Active**.
3. Leave the **Bypass list** empty. In the ruleset UI, an empty list is how the
   owner is kept on the same pull-request path as everyone else.
4. Under **Target branches**, choose **Add target > Include default branch** and
   verify GitHub identifies the default branch as `master`. If the UI does not
   display that option, choose **Include by pattern** and enter exactly
   `master`.
5. Leave **Restrict creations** off.
6. Leave **Restrict updates** off. With an empty bypass list this rule would
   prevent normal pull-request merges from updating `master`.
7. Keep **Restrict deletions** on.
8. Leave linear history, successful deployments, and signed commits off for
   now.
9. Turn on **Require a pull request before merging**. In its expanded options:
   - Set required approvals to `0`.
   - Turn on **Require conversation resolution before merging**.
   - Leave Code Owner review, dismissal of stale approvals, and approval of the
     most recent push off while this remains a solo repository.
   - Turn off **Require an additional approval for unattributed Copilot pull
     requests**. GitHub currently selects this by default, but an additional
     reviewer should not be required in this solo repository.
   - Leave all three existing merge methods allowed; changing merge-history
     style is outside this security rollout.
10. At initial creation, leave **Require status checks to pass** off until the
    CI jobs exist and have run at least once.
11. Keep **Block force pushes** on.
12. Leave code scanning, code quality, code coverage, and automatic Copilot
    review rules off for now.
13. Review the rule and select **Create**.

That initial delay was completed on 2026-11-11 after draft PR #5 established
the check names and passed all three jobs.

## GitHub settings: completed after CI existed

Completed and verified on 2026-11-11:

1. Reopen the `master` protection rule.
2. Enable **Require status checks to pass before merging**.
3. Require `Frontend tests`, `Frontend production build`, and `Worker tests and
   checks`, all from GitHub Actions.
4. Enable **Require branches to be up to date before merging**.
5. Confirm force pushes, deletion, and bypass remain disabled.

## GitHub settings: do after the deployment workflow exists

1. Create a GitHub environment named `production`.
2. Restrict its deployment branch to `master`.
3. Add the owner as required reviewer; do not enable self-review prevention in a
   solo repository.
4. Store production-only GitHub secrets in the environment, never in source.
5. Configure the deployment workflow with `workflow_dispatch` only.
6. Make the workflow explicitly check out current `master`, regardless of which
   branch is selected in the Actions UI.
7. Run tests and build again before the job reaches the production approval.
8. Require the environment approval before any Pages publication step.
9. Remove or replace `npm run deploy` so a laptop cannot publish production.

Do not change the GitHub Pages source or protect `gh-pages` in a way that breaks
the current rollback path until this workflow has been exercised without a
production publication.

## Production cutover

1. Export backups of the current master, milestone-response, and edit-response
   Sheets.
2. Record the current `master` and `gh-pages` commit SHAs.
3. Populate the new `Timeline Source` through a dry-run migration.
4. Exclude add-milestone response rows whose legacy `hide` value is `Y` and the
   confirmed `05/31/1970` bot submissions. Report master hidden rows separately
   and review all migration counts before writing.
5. Verify `Published Timeline (Generated)` in a signed-out browser and confirm
   private tabs cannot be accessed by changing the tab identifier.
6. Deploy and test the production Worker while the existing website still uses
   its old endpoints.
7. Manually run the production frontend deployment and approve the protected
   environment prompt.
8. Smoke-test timeline loading, add milestone, edit proposal, email delivery,
   mobile layout, duplicate handling, and failure messages.
9. Only after smoke tests pass, close both old Google Forms and stop publishing
   both old spreadsheets.
10. Keep the old Sheets private as rollback archives.
11. Update `AGENTS.md` and this document from approved direction to deployed
    current behavior.

## Rollback

- Before old Forms are closed, redeploy the recorded previous Pages build if the
  new frontend fails its production smoke test.
- After the new system is confirmed, rollback disables submissions or redeploys
  the previous display build but never reopens the compromised Google Forms.
- The `SUBMISSIONS_ENABLED` Worker switch is the first response to unexpected
  abuse or upstream failure.

## Cost and usage safeguards

- Keep Cloudflare Workers, D1, and Turnstile on free plans with no automatic
  upgrade. As checked on 2026-11-16, Workers Free has a hard daily request
  limit, D1 Free stops queries at its daily/storage limits instead of billing
  overage, and Turnstile Free includes unlimited challenges. Recheck the
  official [Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
  [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), and
  [Turnstile plans](https://developers.cloudflare.com/turnstile/plans/) before
  provisioning.
- Avoid attaching a Google billing account; if a future Google requirement
  makes that unavoidable, stop and obtain explicit owner approval.
- Standard Sheets API use is currently free, but Google says exceeding request
  quotas is planned to become chargeable later in 2026 when a billing account
  is linked. Keep the staging project unbilled, do not request higher quotas,
  and recheck the official [Sheets API limits](https://developers.google.com/workspace/sheets/api/limits).
- Alert on 100 attempts in 10 minutes, 1,000 attempts in 24 hours, 50 accepted
  submissions in 24 hours, or repeated upstream failures.
- Aggregate counts use one-minute D1 buckets with 48-hour retention. Request
  replay records and delivered alert state retain 30 days; stale undelivered
  alert rows retain at most 90 days. Cleanup runs during the five-minute owner
  alert poll.
- The owner Apps Script checks `MailApp.getRemainingDailyQuota()` and reserves
  ten messages. Reaching a quota leaves notifications queued; it never switches
  to a paid mail service. Recheck the official
  [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas).
- Prefer safe submission failure over paid overage or silent degradation.
