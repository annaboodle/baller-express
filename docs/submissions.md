# Submission security and deployment runbook

Production uses the protected submission flow. See **Production cutover** for the release and retirement checks.

Last reviewed: 2026-11-20

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

## Data flow

Before cutover:

```text
Master spreadsheet CSV -----------+
                                  +--> React merges, filters, and sorts
Form response spreadsheet CSV ----+

React forms --> public Google Forms endpoints --> response spreadsheets
```

Current production:

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

## Production workbook

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
- The owner and one staging-only service account have Drive permission; General
  access remains Restricted and the workbook is not published.
- The whole `Published Timeline (Generated)` tab is protected.
- `Timeline Source!N:N` is protected because it is formula-owned.
- The source rank and public projection are open-ended spill formulas, avoiding
  a silent publication limit when the Sheet grows beyond its initial row count.
- `Edit Proposals!N:Q` is protected because those columns are owner-controlled.
- Formula scans, native-Sheet export inspection, and renders of all three tabs
  pass. The hidden fixture is absent from the generated tab, the formula-like
  fixture remains literal text, and the generated tab contains only seven
  public columns.

The workbook is shared with exactly one staging-only Google service account;
that account has no intended access to either production spreadsheet. Do not
publish the generated tab until the signed-out privacy test is ready;
publishing is not required for Worker storage tests.

## Development isolation

All implementation work occurs on `codex/protected-submissions`.

Local development uses:

- Frontend at `http://localhost:3000`.
- Worker-local development may use `http://localhost:8787`; the current Stage 3
  browser review instead targets the deployed staging `workers.dev` origin.
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

**Completed 2026-11-18.** The staging submission switch is disabled and all
production resources remain unchanged. This completion did not itself authorize
Stage 3; the owner separately authorized Stage 3 later on 2026-11-18.

Completed locally or in the private staging workbook:

- Created and hardened the three-tab native staging workbook with fictional
  fixtures only.
- Created the free staging D1 database `baller-submissions-staging`, applied
  `0001_stage2.sql`, and verified the six application tables plus Wrangler's
  migration ledger. Cloudflare also exposes its internal `_cf_KV` table.
- Created the free Turnstile widget **Baller Express Submissions - Staging** in
  Managed mode, world region, with pre-clearance disabled and only `localhost`
  allowed. Its keys remain in the ignored, owner-readable local secrets file.
- Created the dedicated Google Cloud project **Baller Express Stage 2 Staging**
  (`baller-express-stage-2-staging`) under **No organization** and verified on
  its Billing page that no billing account is linked. Enabled only the Google
  Sheets API.
- Created the service account **Baller Express Stage 2 Worker** with no Google
  Cloud project role and no additional principal access. Validated and imported
  one JSON key into the ignored, owner-only local secret store, then permanently
  deleted the downloaded JSON. Shared only the staging workbook with that
  account as Editor while keeping General access Restricted, and stored the
  Drive-confirmed workbook ID only in ignored local configuration. A live
  read-only check verified service-account authentication, workbook access, and
  both private tab schemas without writing any cell.
- Generated three independent keyed secrets into ignored, owner-only storage;
  declared exactly seven required server secrets in Wrangler; and added tested
  helpers that generate missing keyed values and prepare a seven-key filtered
  deployment file without displaying any value or uploading the public
  Turnstile site key.
- Deployed the staging Worker with `SUBMISSIONS_ENABLED=false`, localhost-only
  CORS, no custom domain, and no production route. The temporary filtered
  secret file was deleted immediately after deployment. Registered the free
  account-level `workers.dev` subdomain, then verified live `204` preflight,
  safe `503 service_unavailable` responses from both disabled submission
  routes, and `401` from the unsigned private alert route. A read-only D1 audit
  confirmed that all six application/telemetry tables remained empty, and a
  bounded Sheet read confirmed the workbook retained exactly its four
  milestone fixtures and one edit fixture. This was the initial disabled
  baseline before the attended enabled-window tests described below.
- Installed the owner-bound Apps Script code and least-privilege manifest,
  granted exactly the current-workbook, outbound-HTTPS, send-mail, and
  trigger-management permissions, passed configuration validation, and
  installed exactly one five-minute `pollBallerExpressStage2` trigger. A manual
  first poll sent the fictional edit-proposal email and atomically changed its
  private notification state from `PENDING` to `SENT` with `notified_at`
  recorded. The script was not deployed as a web app or API executable.
- Implemented fail-closed Turnstile, D1 rate limiting/idempotency/deduplication,
  exact Sheets schemas, RAW writes, partial-commit reconciliation, timeouts,
  safe public responses, and the emergency switch.
- Added a verified existing-event lookup for edit proposals. A nonexistent
  `original_event_id` is rejected before D1 reservation or Sheet append, while
  a true idempotent replay still resolves without repeating the lookup.
- Implemented aggregate-only D1 telemetry, alert cooldown/outbox/lease state,
  HMAC-authenticated internal alert endpoints, retention cleanup, and an
  owner-only Apps Script poller. D1 retains keyed fingerprints, server-owned
  IDs, and a new milestone's seven already-public fields for safe replay; no
  contributor contact, private edit-proposal text, raw IP, token, or raw error
  string enters D1 or an aggregate alert response.
- Added a local-only real-Turnstile smoke harness that is separate from React
  and accepts the staging Worker origin only at runtime; no resource value or
  token is stored in tracked source. Added a bounded, aggregate-only workbook
  auditor whose first live baseline verified four source rows, three generated
  public rows, one proposal row, correct formulas/schemas, and blank private
  columns on the generated tab.
- Completed an attended real-Turnstile window that created one fictional
  milestone and one fictional edit proposal. Verified a successful replay with
  no second row, a changed-payload request-ID conflict, contact-independent
  duplicate rejection, and the observed three-request bot pattern collapsing
  to one creation plus two duplicate responses. A nonexistent edit target was
  rejected before D1 reservation or Sheet append.
- Live requests verified wrong-origin, malformed-JSON, unsupported-media, and
  formula-injection defenses; automated adapter tests cover schema drift and
  upstream timeouts. The final read-only workbook audit reported five source
  rows, four generated public rows, and two private edit proposals; both
  proposal notifications were `SENT`, the generated tab still exposed only
  seven public fields, and all formula ownership checks passed.
- Reached exactly 100 aggregate attempts and two accepted submissions. The
  100-attempt/10-minute alert was delivered once and ACKed. D1 inspection
  showed only enumerated aggregate metrics, keyed fingerprints, server-owned
  identifiers, and public milestone replay fields—not contributor contact,
  private proposal text, raw IPs, tokens, or raw error strings.
- Deliberately made the owner monitor's staging alert endpoint unreachable for
  three consecutive polls, received the independent outage email, restored the
  valid endpoint, and received the recovery email. The automatic five-minute
  trigger remains installed exactly once.
- Restored `SUBMISSIONS_ENABLED=false`, redeployed staging, and reverified safe
  `503` responses from both submission routes, `204` preflight, unchanged
  telemetry/workbook counts, and the final five/four/two row counts. Stopped
  the local smoke harness.
- Verified 88 Worker tests, the SQL migration, workbook formulas, private/public
  projection, and exported-native workbook renders.

Do not assume a Sheets API write invokes a Google Form or `onEdit` trigger. The
time-driven Apps Script poller is the explicit notification mechanism.

- Gate passed: privacy, storage, security, notification, high-usage-alert,
  outage/recovery, and kill-switch tests completed without publishing private
  data or touching production resources.

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
   secrets. Never paste them into tracked files, documentation, or chat. The
   ignored local file must remain mode `600`; use the tested filter to upload
   exactly the seven required server secrets and exclude `TURNSTILE_SITE_KEY`.
8. Keep `SUBMISSIONS_ENABLED=false`; deploy only to the staging `workers.dev`
   hostname with no custom route. Delete the exact temporary secret-upload file
   immediately after the deployment attempt. This deployment completed on
   2026-11-17; the switch remained off and post-deploy D1/Sheet counts matched
   the untouched fixture baseline.
9. If the Cloudflare account has never used Workers before, register its free
   account-level `workers.dev` subdomain under **Compute > Workers & Pages >
   Your subdomain**. This does not connect the production custom domain. Wait
   for TLS/DNS to become available before interpreting smoke-test failures.
   Completed 2026-11-17.
10. In the staging workbook's owner-bound Apps Script project, install both
   `worker/apps-script/Code.gs` and `worker/apps-script/appsscript.json`. Set the
   four Script Properties documented in `worker/apps-script/README.md`, validate
   configuration, grant all four explicitly pinned permissions, and install its
   single five-minute trigger. The Sheet permission is limited to the current
   bound workbook; do not deploy the script as a web app or API executable.
   Completed 2026-11-17: configuration validation passed, exactly one trigger
   was installed, and a manual first poll sent and acknowledged the fictional
   proposal notification.
11. With the switch still off, prove public submission routes return the safe
    unavailable response, do not write Sheets, and do not record usage.
    Completed 2026-11-17: both routes returned the expected safe `503`, allowed
    preflight returned `204`, unsigned private alerts returned `401`, all D1
    application tables stayed empty, and fixture row counts were unchanged.
12. Enable the switch briefly and run fictional milestone/edit-proposal smoke
    tests. Verify exact A:M writes, the retained `publish_rank` formula, one
    generated public row, private contact isolation, and owner email delivery.
    Use `worker/scripts/serve-staging-smoke.mjs` at the literal
    `http://localhost:3000`; it is a local test tool, not the Stage 3 frontend.
    Run `npm run audit:staging-sheets` before and after the attended window.
    Completed 2026-11-17: one milestone and one edit proposal were accepted;
    the final aggregate workbook counts were five source rows, four generated
    public rows, and two proposals. Both proposal notifications became `SENT`.
13. Test replay, request-ID conflict, contact-independent duplicate detection,
    the observed three-request bot burst, wrong-origin and malformed requests,
    schema drift, upstream timeouts, and formula-like literal text.
    Completed 2026-11-17: replay returned the stored result, conflict and two
    duplicate responses created no extra rows, a missing edit target failed
    before reservation, and the live HTTP boundary cases failed safely.
    Formula-like text stayed literal and the public projection remained
    private-data-free. Automated adapter tests cover schema drift and upstream
    timeout paths without mutating provider resources.
14. Trigger and receive one real 100-attempt/10-minute aggregate alert. Verify
    no contributor contact, private edit-proposal text, raw IP, token, or raw
    error string appears in D1, Worker logs, the aggregate alert API, Script
    Properties, or the aggregate alert email. Test the owner-side
    outage/recovery path separately.
    Completed 2026-11-18: D1 reached 100 aggregate attempts and two accepted
    submissions; one threshold alert was delivered and ACKed. D1 schema and
    read-only queries plus the observed alert email remained aggregate-only;
    checked-in code and tests enforce the same redaction contract for the API,
    logs, and Script Properties. Three deliberate monitor failures sent the
    outage email, and one healthy poll after restoration sent the recovery
    email.
15. Exercise the kill switch while staging is enabled and confirm new attempts
    fail before rate limiting, Turnstile, Sheets, or telemetry. Leave staging
    disabled after testing.
    Completed 2026-11-17: after redeploying with the switch disabled, both
    submission routes returned `503`, preflight returned `204`, and disabled
    requests changed neither telemetry nor workbook counts. Staging remains
    disabled.
16. Record resource names, non-secret settings, test results, and teardown/key
    rotation steps here. The owner accepted the Stage 2 gate and separately
    authorized Stage 3 on 2026-11-18. Completed in this runbook and `AGENTS.md`.

#### Stage 2 maintenance, rotation, and teardown

- Keep the staging workbook, Worker, D1 database, Turnstile widget, Apps Script,
  and trigger available for an explicitly authorized Stage 3, but leave
  `SUBMISSIONS_ENABLED=false` between attended windows.
- Rotate `ALERT_POLL_SECRET` only in a disabled maintenance window. Update the
  Worker secret and Apps Script property as one coordinated change, then run one
  healthy manual poll before ending the window.
- Rotate `RATE_LIMIT_SECRET` or `REQUEST_HASH_SECRET` only while disabled. A
  rotation intentionally invalidates existing keyed rate-limit, deduplication,
  or replay fingerprints; verify fresh fictional submissions before re-enabling.
- For a Google service-account key rotation, create and validate a replacement,
  import it into ignored owner-only storage, update the disabled staging Worker,
  and verify workbook access before disabling and then deleting the replaced
  key. Never keep the downloaded JSON after import. Follow Google's documented
  [create, replace, disable, verify, and delete sequence](https://docs.cloud.google.com/iam/docs/key-rotation).
- For a Turnstile secret rotation, keep submissions disabled, use Cloudflare's
  widget secret-rotation flow, update the Worker during the documented grace
  period, verify a real local challenge, and only then consider re-enabling.
  Cloudflare documents the current
  [two-hour overlap behavior](https://developers.cloudflare.com/turnstile/troubleshooting/rotate-secret-key/).
- If staging is abandoned, first keep submissions disabled and preserve any
  needed aggregate evidence. Then remove the Apps Script trigger, revoke and
  delete the service-account key, remove the service account's workbook access,
  and delete only the staging Worker, D1 database, Turnstile widget, workbook,
  and Google Cloud project after checking every target. No production resource
  is part of this teardown.

### Stage 3: local frontend integration

**Completed with the owner's desktop/mobile approval on 2026-11-20.** The
attended frontend integration smoke passed on 2026-11-19. Production still
uses the old frontend, Forms, and published feeds.
The staging Worker remains disabled except for an attended fictional-data
review window.

Implemented on `codex/protected-submissions`:

- Removed both direct Google Forms posts from the feature-branch React forms.
  `src/submissions.js` now owns the fail-closed staging configuration, safe
  response parsing, and the exact `/v1/milestones` and `/v1/edit-proposals`
  requests.
- Added `SubmissionModal`, so each submission form and its optional private
  contributor state exist only while that modal is open. Close, backdrop,
  Escape, focus trapping/restoration, and busy-state dismissal are tested.
- Added explicitly rendered Turnstile widgets using actions `add_milestone` and
  `edit_proposal`. Tokens remain in memory, are never rendered or logged, and a
  fresh challenge runs for every manual retry.
- Added retry-safe request IDs. An identical retry retains its request ID so the
  Worker can replay safely; editing the payload creates a new ID. Duplicate and
  request-conflict outcomes never create a second optimistic event.
- Added native field constraints plus safe loading, unavailable, timeout,
  validation, verification, rate-limit, and retry messages. The API sends no
  browser credentials, refuses redirects, and allowlists the seven public event
  fields from a milestone response.
- A successful milestone is inserted immediately into the submitter's local
  timeline and updates both people-filter lists. A successful edit proposal
  only shows a private-review confirmation; it never mutates the timeline.
- Submission result banners use the owner-approved copy from the 2026-11-19
  review and a short fade-and-slide transition on appearance and dismissal;
  reduced-motion preferences shorten it to near-instant behavior.
- Edit controls are disabled on legacy rows without an immutable `event_id`.
  The browser does not fabricate IDs; Stage 4 migration supplies them.
- Frontend tests and an optimized production build pass locally. No deployment
  command has been run.

#### Attended Stage 3 smoke

During an attended 2026-11-19 window, the real React frontend submitted one
fictional milestone with contributor name and email left blank. The accepted
milestone appeared immediately in the local timeline, and its fictional person
appeared in the people filter. The same window submitted one fictional edit
proposal against that ID-bearing milestone; the approved confirmation banner
appeared and the visible milestone remained unchanged. The final private
workbook audit found six source rows, five generated public rows, and three
proposal rows. All three proposal notifications were `SENT`, and the schemas,
open-ended formulas, formula ownership, visible-row count, and privacy checks
passed. The final aggregate-only D1 counts were four request records, two
dedupe locks, two rate-limit windows, four metric buckets, one alert-state row,
and one alert-outbox row; request records increased by exactly two from the
baseline, matching the milestone and edit proposal. The switch was restored to
`false`, both submission routes returned `503 service_unavailable`, and the
local review server was stopped. Production resources were unchanged.

#### Stage 3 local setup

1. Copy tracked `.env.example` to ignored `.env.development.local`.
2. Fill only `REACT_APP_STAGE3_WORKER_ORIGIN` with the path-free HTTPS staging
   `workers.dev` origin and `REACT_APP_STAGE3_TURNSTILE_SITE_KEY` with the public
   staging site key. Never add the Turnstile secret or any Google credential.
3. Start or restart the frontend with `npm start`; Create React App reads these
   variables only at startup.
4. Open exactly `http://localhost:3000`, not `127.0.0.1` or another port. The
   browser integration intentionally fails closed everywhere else.
5. Keep `SUBMISSIONS_ENABLED=false` during layout-only review. Enable it only
   for a short attended window using fictional content, then return it to
   `false` and rerun the aggregate-only staging workbook audit.

#### Stage 3 owner review gate

- Review the add and edit forms at desktop and mobile widths, including long
  milestone descriptions and the full people list.
- Confirm both forms are absent from the DOM while closed; opening focus enters
  the dialog, Tab stays inside it, and close, backdrop, Escape, and focus return
  behave correctly when no request is running.
- Confirm the disabled/unavailable, verification, loading, safe error, and
  manual retry states are understandable. A busy request must not allow the
  modal to close.
- In one attended enabled window, submit fictional data and confirm the new
  milestone appears immediately and new people appear in filters.
  - Observed on 2026-11-19 with one fictional milestone and one fictional
    person; contributor name and email were blank.
- Submit a fictional edit proposal and confirm the private-review message
  appears while the visible timeline remains unchanged and the owner email is
  aggregate/private as designed.
  - Observed on 2026-11-19; the approved banner appeared, the timeline remained
    unchanged, and the private notifier advanced the proposal to `SENT`.
- Confirm a legacy row's edit control is visibly disabled, optional contributor
  contact never appears in the timeline or page source, an unchanged retry does
  not create another row, and a duplicate receives the safe duplicate message.
- End the window by restoring `SUBMISSIONS_ENABLED=false`, verifying both routes
  return the safe unavailable response, and comparing aggregate workbook/D1
  counts. Stage 3 is complete only after the owner approves this review.
  - Observed on 2026-11-19; the final aggregate counts are recorded above, both
    routes returned `503 service_unavailable`, and the local server was stopped.

The local browser review covered 1440 × 900 and 390 × 844. On desktop, both
forms opened and the edit dialog kept keyboard focus inside, then returned it
to the edit button on dismissal. At phone width both forms fit horizontally,
including the edit form for a milestone with 23 people. The contact fields
stacked on mobile. Dismissing either form removed it from the page, and
reopening it showed empty contact fields. All 210 legacy edit controls were
disabled outside the layout preview. Frontend tests covered retries and
duplicate responses. The live replay and duplicate checks used the Stage 2
Worker harness. The local browser review made no submissions.

### Stage 4: migration rehearsal

On 2026-11-20 the three original workbooks were exported to private XLSX
backups. Both live published CSVs were captured separately for comparison. The
rehearsal used a separate copy of the three-tab staging workbook named
**Baller Express — Stage 4 Migration Rehearsal**. Drive reported only the
owner had access, both before loading the data and after verification.

| Legacy source | Snapshot | Rehearsal outcome |
| --- | ---: | --- |
| Master, `Timeline` | 124 | All 124 retained. No hidden flag column or hidden data rows. |
| Add-milestone responses | 188 | 86 visible milestones retained. All 102 rows marked `hide=Y` excluded. Of those, 81 also had the known spam date of 1970-05-31. |
| Master, `Uncategorized` | 61 | Backed up as off-timeline drafts. |
| Old edit responses | 130 | Archived privately. No edits applied or queued for a new email. |

The two legacy feeds and the generated tab agreed on all six display fields
for all 210 rows in source order after date and display-default conversion.
The generated tab's columns were exactly `event_id`, `date`, `precise`, `event`,
`people`, `type`, and `size`. All IDs were unique, all 210 original milestone
references passed the Worker's edit validator, and all 210 native publication
ranks matched the expected row positions. No known contributor email occurred
in the projected values. Readback also matched all 13 private source columns.

The rehearsal preserved all 46 approximate dates. Seven blank precision flags
became `Y` and missing submission sizes became `m`, matching the legacy
frontend's display defaults. One visible legacy response had no submission
timestamp. Its timestamp remains blank. Existing timestamps were converted from
the add-response workbook's `America/New_York` time zone to numeric UTC Sheet
timestamps. Source attribution stays private.

**Repeat the local comparison.** Use an owner-only snapshot directory under
the Git-ignored `.migration-private/`, outside the frontend build. Keep the
exports as `master.xlsx`, `milestones.xlsx`, and `edits.xlsx`. Name the original
published feeds `master-published.csv` and `milestones-published.csv`. With
Python 3.9+ and `openpyxl` installed, run:

```sh
python3 scripts/rehearse-migration.py .migration-private/2026-11-20 --form-time-zone America/New_York
```

The command reads local files, prints counts, and saves an owner-only
`rehearsal.json` with the input checksums, literal A:M values and a source-row
to event-ID mapping. The same frozen inputs reproduce the same IDs. Use a
fresh snapshot directory at cutover. Match it against the approved mapping
before writing, especially when a master event or an untimestamped response
has been edited since the snapshot. New IDs must only be assigned to genuinely
new milestones. Review ambiguous matches with the owner.

For the native rehearsal, write A:M as typed literal cells in the separate
private copy. Leave the N2 and generated A2 formulas in place. Clear only the
copied example proposals, keeping the edit queue empty. Compare the native
private rows and the actual formula output with the local snapshot. Report
aggregate counts and schema only in tracked project files.

**Approved 2026-11-20.** The owner approved the 210-row migration and Stage 5 preparation. Production deployment and retirement of the old Forms
have separate approvals.

### Stage 5: production infrastructure, still dark

- Create the production workbook, Worker, Turnstile configuration, secrets,
  notification/alerting mechanism, and manual-only deployment workflow.
- Test the production Worker directly while the live site still uses its old
  Google Forms and feeds.
- Configure the GitHub production environment and deployment approval with the
  owner.
- Gate: owner explicitly approves cutover. No merge or production frontend
  deployment is implied by this stage.

**Verified on 2026-11-20.** The production workbook is a separate restricted
copy. Its production service account has workbook Editor access and no project
role. The Sheets API is enabled and Google Cloud billing is unlinked. Rotate
the uploaded public certificate and the matching Worker secret before
2027-11-20. A read with that identity matched all 210 source rows against the
approved snapshot, all 210 generated rows against the seven public fields, and
an empty proposal queue. The three owner-only protections were verified.

The separate production D1 database has its migration applied. The Managed
Turnstile widget allows only the live site hostname. The production Worker
uses the seven isolated secrets and disabled switch from the production
Wrangler configuration. Direct probes returned 204 for allowed preflight,
503 for both submission routes, 401 for unsigned polling and 200 with an
empty alert list for signed polling. All six D1 table counts were zero.

The production-bound notification project has the shared Code.gs installed.
Set OWNER_EMAIL, PRODUCTION_SPREADSHEET_ID, PRODUCTION_WORKER_URL, and
ALERT_POLL_SECRET in its Script Properties. Use the production polling secret
from the local owner-only store. Check the four manifest scopes against
worker/apps-script/appsscript.json, run setupBallerExpressProductionTrigger
as the owner, then verify one five-minute production trigger and a successful
poll. On 2026-11-20 the owner saved the four properties, reviewed and
authorized the four expected permissions, and verified one time-based
`pollBallerExpressProduction` trigger. The manual production poll completed
in two seconds. The owner confirmed `consecutiveFailures` was zero in
`BALLER_WORKER_HEALTH_V1` after the run.

The manual Production Pages workflow defaults to a verification-only run.
GitHub requires owner review of the production environment, allows only the
master branch, and disables admin bypass. Three public repository variables
supply the Worker origin, Turnstile site key, and published CSV for the single
generated tab. A publication run checks the feed schema and current master revision.

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

The owner authorized cutover on 2026-11-20. Fresh backups of all three legacy
Sheets and both published feeds reproduced the approved 210 rows, their IDs,
and the archived count of 130 edit responses. Source and Pages rollback SHAs
are saved with the private cutover snapshot. The populated production workbook
already matches these rows.

PR #5 merged at `8c8cbcd`. The signed-out CSV matched all seven columns and
210 milestones. Requests for both private tab IDs returned HTTP 401. The owner
approved the verification-only Actions run `44820111131`, which passed. Pages
was switched to GitHub Actions with the existing custom domain and HTTPS
settings. The owner approved publication run `44820616564`, which succeeded.
The live site rendered 210 edit controls. The add form opened on desktop and the
edit form fit a 390-pixel mobile viewport. The production Worker was enabled,
and both submission routes returned HTTP 204 for the live site's CORS preflight.

The first real milestone was accepted exactly once and appeared in the signed-out
feed (211 rows). The first private proposal was marked SENT and the owner
confirmed delivery. Both old Forms then showed the closed notice to signed-out
visitors. The 188 archived milestone responses and 130 archived edit responses
matched their cutover row counts and timestamps. There were no late responses to
import. Both old published feed URLs returned HTTP 401. The owner also set
general access to Restricted on the legacy master and milestone-response files.
Signed-out direct exports of all three archives then returned HTTP 401.
The live generated CSV still returned HTTP 200 with 211 unique milestones
and exactly seven public columns.

The owner accepts a brief interruption to the public timeline if it makes the
switch simpler. Back up the data, record rollback revisions, and test the Worker
in advance. If downtime helps, use it during the frontend switch, then check
the new build at the usual public URL. Before the Forms were closed, their
direct links could still accept responses during a site outage.

1. Export backups of the current master, milestone-response, and edit-response
   Sheets.
2. Record the current `master` and `gh-pages` commit SHAs.
3. Run the rehearsed migration in dry-run mode against the cutover snapshot.
4. Exclude add-milestone response rows whose legacy `hide` value is `Y` and the
   confirmed `05/31/1970` bot submissions. Report master hidden rows separately
   and review all migration counts before populating the approved production
   workbook.
5. Verify `Published Timeline (Generated)` in a signed-out browser and confirm
   private tabs cannot be accessed by changing the tab identifier.
6. Deploy and test the production Worker while the existing website still uses
   its old endpoints.
7. Manually run the production frontend deployment and approve the protected
   environment prompt.
8. Smoke-test timeline loading, add milestone, edit proposal, email delivery,
   mobile layout, duplicate handling, and failure messages.
9. After the smoke tests pass and the owner gives final confirmation, close
   both old Google Forms and stop publishing both old spreadsheets.
10. Compare the closed Forms' final responses with the cutover snapshot.
    Account for late milestones under the same inclusion rules and keep late
    edit proposals in private review. Check for duplicates before importing
    any missing rows. Keep the old Sheets private as rollback archives.
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
