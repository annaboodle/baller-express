# Baller Express project guide

Last reviewed: 2026-11-20

## Keep this file alive

Treat this file as maintained project memory, not an append-only diary.

- Read it before changing the project.
- Update it in the same change whenever architecture, commands, data contracts,
  deployment, or important product constraints change.
- Keep current behavior separate from approved-but-unimplemented plans.
- Remove or revise stale guidance instead of leaving contradictions behind.
- Keep detailed setup and operational procedures in `docs/submissions.md` and
  link to them here.
- Never add credentials, secret values, private URLs, personal email addresses,
  raw spam payloads, or screenshots.

## Purpose and product behavior

The Baller Express is an unlisted-public timeline of milestones in a friend
group: introductions, moves, trips, weddings, babies, and other events.

- Anyone with the URL can view the timeline; it is not authenticated.
- New milestones publish immediately after server acceptance. The Worker sets
  owner-controlled publication fields; the browser cannot set them.
- Proposed edits remain private for manual review and trigger an owner email.
- Contributor name and email are optional and must remain private.
- Preserve the original website's UX, UI, and copy exactly while implementing
  security or infrastructure work. Do not add, remove, reword, restyle, or
  rearrange anything user-visible without the owner's explicit prior approval.
  If a technical requirement appears to need a user-visible change, show the
  proposed wording or layout to the owner and wait for approval before editing.

## Current production

GitHub Actions publishes the React site from protected `master` after owner approval. The site reads one seven-column generated CSV. Turnstile and the production Worker handle both forms. The old forms are closed. See **Production cutover** below for verification and the late-response reconciliation.

## Legacy implementation before cutover

This section describes the legacy site. For release status see **Production cutover** below.

- The frontend is Create React App with React 16 and is hosted on GitHub Pages.
- Source lives on `master`; the live site is served from the root of the
  separate `gh-pages` branch using GitHub Pages' legacy branch deployment.
- There is no automatic deployment workflow. `npm run deploy` builds locally
  and pushes `build/` to `gh-pages`; do not run it during feature development.
- The browser downloads and merges two published Google CSVs: a curated master
  spreadsheet and the add-milestone response spreadsheet.
- Both custom React forms post directly to public Google Forms endpoints.
- The add-milestone response CSV includes contributor contact columns even
  though React does not render them, so the raw published response sheet is a
  privacy boundary that must be removed at cutover.
- The forms remain mounted while their modals are CSS-hidden. Confirmed bot
  traffic scans those hidden forms, submits the edit form three times, then the
  add form three times, usually about five seconds apart.
- The current bot uses `05/31/1970` for milestone dates. This is evidence, not a
  sufficient long-term blocking rule.

## Stage 1 branch status

Stage 1 was completed on 2026-11-11 in then-draft PR [#5](https://github.com/annaboodle/baller-express/pull/5), which merged during cutover.

- `src/App.test.js` contains four project-specific baseline tests for feed
  merging/sorting, hidden rows, approximate dates, type/people filtering, and
  edit context.
- `.github/workflows/ci.yml` defines read-only, non-deploying pull-request jobs
  for `Frontend tests`, `Frontend production build`, and `Worker tests and
  checks`. All three succeeded in the first real pull-request run on
  2026-11-11.
- At Stage 1 completion, `worker/` was a credential-free, fail-closed API
  foundation with strict validation and mock-adapter tests. Stage 2 additions
  are tracked separately below.
- `npm run check` passes locally, the owner completed local visual review, and
  draft PR #5 passed all three CI jobs. The owner then enabled those exact jobs
  as required, up-to-date checks on the `Protect master` ruleset. All Stage 1
  gates are complete.

## Stage 2 branch status

Stage 2's isolated staging gate was completed on 2026-11-18 on
`codex/protected-submissions`. The staging-only Worker is deployed with its
submission kill switch disabled; the live site, production Forms, production
Sheets, `master`, and `gh-pages` are unchanged. Stage 2 did not itself authorize
Stage 3; the owner separately authorized Stage 3 on 2026-11-18.

- The private native Google Sheet **Baller Express — Stage 2 Staging** has the
  approved three tabs, fictional fixture data only, and timezone `Etc/UTC`.
  General access remains Restricted; only the owner and the staging-only
  service account have access.
- The free Cloudflare D1 database `baller-submissions-staging` was created on
  2026-11-16. Its ID is kept only in the ignored local Wrangler configuration;
  remote migration `0001_stage2.sql` has been applied and verified. It contains
  the six expected application tables plus Wrangler's migration ledger;
  Cloudflare also exposes its own internal `_cf_KV` table.
- The free Turnstile widget **Baller Express Submissions - Staging** was created
  on 2026-11-16 in Managed mode, world region, with no pre-clearance and only
  `localhost` allowed. Its keys are kept only in the ignored local `.dev.vars`,
  which has owner-only file permissions.
- The dedicated Google Cloud project **Baller Express Stage 2 Staging**
  (`baller-express-stage-2-staging`) was created on 2026-11-16 under **No
  organization**. Its Billing page explicitly reports that the project has no
  billing account; do not link one. Only the Google Sheets API has been enabled.
- The staging service account **Baller Express Stage 2 Worker** was created with
  no Google Cloud project role and no additional principal access. One JSON key
  was validated and imported into the ignored, owner-only local secret store;
  the downloaded JSON was permanently deleted. The staging workbook is shared
  with that account as Editor, its General access remains Restricted, and Drive
  metadata confirmed only the intended staging file ID for ignored local use.
  A live read-only check then verified service-account authentication, workbook
  access, and both private tab schemas without writing any cell.
- The entire generated tab, `Timeline Source!N:N`, and
  `Edit Proposals!N:Q` are protected so future non-owner editors cannot alter
  generated formulas, notification timestamps, or review decisions.
- The native workbook uses one open-ended `ARRAYFORMULA` for `publish_rank` and
  one open-ended `FILTER` projection for the public tab, so accepted rows are
  not limited by a prefilled formula range.
- The local Worker now has staging-only D1, Turnstile, Google OAuth/Sheets,
  idempotency, deduplication, rate-limit, schema-drift, timeout, telemetry,
  alert-outbox, retention, and internal HMAC alert implementations.
- Edit proposals now perform a live `Timeline Source` lookup after Turnstile
  verification and before any D1 reservation or append. A nonexistent target
  returns a safe field error; idempotent replays still resolve before this
  lookup.
- The owner-only Apps Script source polls private edit proposals and aggregate
  Worker alerts every five minutes, reserves mail quota, retries safely, and
  independently reports a repeated Worker/D1 polling outage. Its explicit
  manifest limits Sheet access to the bound staging workbook and pins only the
  current-workbook, outbound-HTTPS, send-mail, and trigger-management scopes.
  On 2026-11-17 the owner installed both tracked files, granted exactly those
  four permissions, passed configuration validation, and installed exactly one
  time-driven `pollBallerExpressStage2` trigger. A manual first poll sent the
  fictional staging proposal email and changed its private notification state
  from `PENDING` to `SENT` with `notified_at` recorded. On 2026-11-18 the owner
  also received the independent alert after three deliberate polling failures
  and the recovery email after the valid staging endpoint was restored.
- Three independent keyed staging secrets were generated into the ignored,
  owner-only local secret store. Wrangler declares exactly seven required
  server secrets. A tested filter creates an owner-only upload file containing
  only those seven values and excludes the public Turnstile site key.
- The Worker was deployed to Cloudflare staging on 2026-11-17 with
  `SUBMISSIONS_ENABLED=false`, localhost-only CORS, the staging D1 binding, no
  custom domain, and no production route. The temporary secret-upload file was
  deleted immediately. The free account-level `workers.dev` subdomain was then
  registered. Live smoke tests returned `204` for allowed CORS preflight, the
  safe `503 service_unavailable` response from both disabled submission routes,
  and `401` from the unsigned private alert route. All six D1 application
  tables remained empty, and the staging workbook retained exactly its four
  milestone fixtures and one edit fixture.
- A credential-free localhost smoke harness now exists solely for Stage 2
  provider tests. It binds to local IPv4 port 3000, requires the literal
  `localhost:3000` Host header, obtains only the public Turnstile site key from
  ignored local configuration, accepts the staging `workers.dev` origin only
  at runtime, and never displays or logs verification tokens. It is separate
  from React and is never deployed.
- The read-only staging workbook auditor fetches bounded ranges and reports
  only aggregate counts and schema/formula/privacy booleans. Its first live
  baseline saw four source rows, three generated public rows, and one proposal
  row; all checks passed and no private columns appeared in the generated tab.
- During one attended enabled window, a real Turnstile token created exactly
  one fictional milestone and one edit proposal. A true replay returned the
  stored result without another row; a changed-payload request-ID conflict and
  two contact-independent duplicates were rejected. This reproduced the
  observed three-request burst as one creation plus two duplicate responses.
  Missing edit targets, wrong origins, malformed JSON, unsupported media, and
  formula-like input were also handled safely.
- The final workbook audit found five source rows, four generated public rows,
  and two proposal rows. Both proposal notifications were `SENT`; the generated
  tab still contained only the seven public fields, formula spill ownership was
  intact, and the formula-like submission remained literal text.
- Aggregate staging telemetry reached exactly 100 attempts and two accepted
  submissions. The 100-attempt/10-minute alert was emailed and acknowledged;
  D1 retained only enumerated counters, keyed fingerprints, server-owned IDs,
  and public replay fields. The owner-side polling outage and recovery emails
  were then verified separately.
- The submission switch was returned to `false` and redeployed after the
  enabled window. Both submission routes again returned the safe `503`, while
  preflight remained available; disabled requests changed neither telemetry nor
  workbook counts. The local smoke harness was stopped.
- `npm --prefix worker test` currently passes 88 tests; the D1 migration also
  loads successfully in SQLite. Local and exported-native workbook formula and
  visual checks pass.
- All Stage 2 privacy, storage, security, deduplication, notification,
  high-usage-alert, outage/recovery, and final kill-switch gates passed.

## Stage 3 branch status

The owner approved the desktop and mobile review on 2026-11-20, completing
Stage 3 and authorizing the Stage 4 staging migration rehearsal. The attended
frontend-to-staging integration smoke passed on 2026-11-19, while production was still using the legacy Forms and feeds.
The staging Worker remains disabled outside an attended review window.

- `src/submissions.js` is the fail-closed browser configuration and API boundary.
  Local review requires `REACT_APP_STAGE3_WORKER_ORIGIN` and
  `REACT_APP_STAGE3_TURNSTILE_SITE_KEY` in an ignored local environment file.
  The browser accepts them only at exact `http://localhost:3000` and only with a
  path-free HTTPS `workers.dev` Worker origin.
- Submission forms are conditionally mounted through `SubmissionModal`; no form
  or contributor-contact state exists in the DOM while its modal is closed.
- Each form uses an explicitly rendered Turnstile widget with the exact Worker
  action, server-bound request validation, loading/error states, a fresh token
  for every attempt, and one stable request ID for an unchanged manual retry.
- The browser posts only to `/v1/milestones` and `/v1/edit-proposals`. A request
  times out safely, follows no redirects, sends no credentials, and exposes only
  allowlisted public event fields from a successful response.
- A newly accepted milestone is inserted optimistically into the local timeline
  and its people are added to both filter lists. An accepted edit proposal only
  shows a private-review confirmation and never changes the timeline.
- Submission result banners use the owner's approved 2026-11-19 copy and a
  short fade-and-slide transition on appearance and dismissal. Reduced-motion
  preferences shorten that transition to near-instant behavior.
- Legacy production-feed rows do not have immutable `event_id` values. Their
  edit controls remain disabled until migration rather than inventing IDs in the
  browser; staged or migrated ID-bearing rows can open the edit form.
- During an attended 2026-11-19 window, the real React frontend submitted one
  fictional milestone with contributor name and email left blank. The accepted
  milestone appeared immediately in the local timeline, and its fictional
  person appeared in the people filter. The same window submitted one fictional
  edit proposal against that ID-bearing milestone; the approved confirmation
  banner appeared and the visible milestone remained unchanged. The final
  private workbook audit found six source rows, five generated public rows, and
  three proposal rows; all three proposal notifications were `SENT`, and every
  schema, formula-ownership, and privacy check passed. The aggregate-only D1
  audit found four request records, up from two at baseline and matching exactly
  the two accepted submissions; retention-managed table counts remained safe.
  The switch was restored to `false`, both submission routes returned the safe
  `503 service_unavailable` response, and the local review server was stopped.
- Automated frontend tests, the production build, the attended frontend
  integration smoke, and the desktop/mobile review passed. See
  `docs/submissions.md` for the review results.

## Stage 4 branch status

The 2026-11-20 migration rehearsal passed in a separate, owner-only native
Google Sheet. All 210 visible milestones matched the two legacy feeds, with
210 distinct event IDs and exactly seven generated public columns. The
rehearsal preserved the original private contributor data in the source tab.
Historical edit responses and the master's off-timeline drafts are backed up
separately. The Stage 2 workbook still serves fictional fixtures only.

The owner approved the migration report and production preparation on 2026-11-20. See the Stage 4 section of `docs/submissions.md` for the exclusions,
backup and ID mapping procedure, and checks.

## Stage 5 production preparation

The restricted production workbook matches all 210 approved source and generated
rows. Its seven-column projection, three owner protections, and empty edit
queue were verified. The separate production service account can read the
workbook. The production Worker was initially deployed with submissions disabled. Its
two submission routes returned 503 and the signed alert poll reached D1.
All six application tables were empty after verification.

The manual Pages workflow was included in PR #5. The GitHub production
environment requires the owner, restricts deployments to master, and disables
admin bypass. The production notification code is saved in the bound project.
The owner configured the four Script Properties, authorized the notifier, and
verified one time-based `pollBallerExpressProduction` trigger. The manual
poll completed with zero consecutive Worker polling failures on 2026-11-20.
The owner authorized the controlled cutover that day. Fresh private exports
reproduced all 210 approved rows and IDs. The owner confirmed no new submissions
or edits before the release.
See the Stage 5 section in `docs/submissions.md`.

## Production cutover

On 2026-11-20, PR #5 merged into protected `master` at `8c8cbcd`. The
signed-out production CSV matched all 210 approved milestones and seven public
columns. Both private tab IDs returned HTTP 401. The owner approved verification
run `44820111131`, which passed. Pages now uses GitHub Actions with the existing
custom domain and enforced HTTPS. Owner-approved run `44820616564` published
the live release. The live timeline rendered all 210 migrated milestones.
The production Worker accepted the first real milestone exactly once, bringing the
public count to 211. One private edit proposal triggered the email the owner
confirmed receiving. After owner approval both old Forms were closed. The two
legacy published CSVs returned HTTP 401. The old response archives matched the
cutover snapshot (188 milestone responses and 130 edit responses).

## Production architecture

The production workbook has three tabs:

1. `Timeline Source` -- private canonical data edited by the owner and Worker.
2. `Published Timeline (Generated)` -- protected, formula-generated, sanitized,
   and the only tab published to the web.
3. `Edit Proposals` -- private manual-review queue with notification state.

Milestone submissions follow this path:

`custom React form -> Cloudflare Turnstile -> Cloudflare Worker -> Timeline Source`

- The Worker verifies Turnstile server-side, validates the payload, rate-limits,
  deduplicates, and writes through the Google Sheets API.
- Accepted milestones are written once to `Timeline Source`; the generated tab
  projects only public fields and immediately includes rows whose
  owner-controlled `hide` value is not `Y`.
- Edit proposals are written only to `Edit Proposals` and never auto-apply.
- The website reads one CSV: `Published Timeline (Generated)`.
- Keep the old Google Forms closed and the legacy feeds unpublished.

See `docs/submissions.md` for the complete design, staging, GitHub settings,
cutover, and rollback checklist.

## Data and security invariants

- Milestone dates must be on or after `1971-01-01`; future dates are allowed.
- `precise=N` means the displayed date is approximate; preserve this legacy
  semantic unless the data migration deliberately replaces it everywhere.
- `hide=Y` is owner-controlled. Never accept `hide`, publication status,
  timestamps, or a new canonical ID from the browser. An edit proposal must
  submit the immutable `event_id` of an existing milestone as its private
  target reference; the Worker still generates every new event/proposal ID.
- During the legacy migration, do not import rows from the old add-milestone
  response sheet when that row has `hide=Y`. This rule is specific to that
  legacy source and does not by itself decide how hidden master rows migrate.
- `Published Timeline (Generated)` contains no contributor contact data.
- Turnstile must be verified by the Worker; a client-side widget alone is not a
  trust boundary.
- The Worker fails closed when verification or storage is unavailable.
- Logs omit form payloads, contact details, Turnstile tokens, and raw IPs.
- Write user content to Sheets as literal strings to prevent formula injection.
- `Timeline Source` is exactly A:N: `event_id`, `date`, `precise`, `event`,
  `people`, `type`, `size`, `hide`, `source`, `submitted_at`, `submission_id`,
  `contributor_name`, `contributor_email`, `publish_rank`. The Worker appends
  A:M only; N is formula-owned.
- `Edit Proposals` is exactly A:Q: `proposal_id`, `submission_id`, `source`,
  `submitted_at`, `original_event_id`, `original_date`,
  `original_description`, `original_people`, `fields`, `requested_change`,
  `contributor_name`, `contributor_email`, `notification_status`,
  `notified_at`, `review_status`, `reviewed_at`, `reviewer_notes`. The Worker
  appends A:M only; the owner notification/review process owns N:Q.
- Individual people names cannot contain commas because Sheets stores the
  validated list as a reversible comma-separated value.
- Forms should not exist in the DOM until their modal is opened.
- Old Forms stay closed after cutover; rollback must never reopen them.

## Cost invariants

The submission system must remain on free tiers and fail safely rather than
silently start paid usage.

- Do not upgrade Cloudflare Workers, D1, or Turnstile to a paid plan.
- Do not attach Google billing unless a future requirement is explicitly
  reviewed and approved by the owner.
- Keep Google API quotas conservative; do not request increases casually.
- Alert the owner on unusual usage well below provider limits: 100 attempts in
  10 minutes, 1,000 attempts in 24 hours, or 50 accepted submissions in 24
  hours.
- Repeated Turnstile, D1, or Sheets failures also trigger an owner alert.
- Preserve an emergency `SUBMISSIONS_ENABLED` kill switch.

## Git and production safety

- Develop this project on `codex/protected-submissions`, never directly on
  `master` or `gh-pages`.
- `master` must be protected: pull requests required, checks required once they
  exist, force pushes and deletion blocked, and bypass disabled.
- Protection was enabled on 2026-11-09 with the active **Protect master**
  ruleset. It targets `master`, has an empty bypass list, requires pull requests
  with zero approvals and conversation resolution, restricts deletion, and
  blocks force pushes. On 2026-11-11 the owner enabled strict, up-to-date status
  checks for `Frontend tests`, `Frontend production build`, and `Worker tests
  and checks` after all three succeeded on draft PR #5.
- GitHub currently presents this as a repository ruleset. Use an active
  `Protect master` ruleset with an empty bypass list, target the default branch
  after confirming it is `master`, require pull requests with zero required
  approvals and conversation resolution, restrict deletion, and block force
  pushes. Disable the default extra approval for unattributed Copilot pull
  requests in this solo repository. Add or rename a required check only after
  its replacement has succeeded on a real pull request.
- Local development uses staging/test resources only. It must not write to the
  production workbook or modify the current Forms.
- Merging source to `master` must not deploy production.
- Production deployment uses a manually triggered GitHub Actions workflow
  that rebuilds protected `master`, reruns checks, and pauses for explicit
  environment approval.
- Use **Production Pages** for releases. Preserve the legacy `gh-pages` branch
  as the pre-cutover display snapshot.
- The owner accepts a brief interruption to the public timeline during an
  approved production cutover if it simplifies the switch. See the production
  cutover checklist in `docs/submissions.md`.

## Run and verify the current frontend

Install and start locally:

```sh
npm ci
npm start
```

Run all current checks:

```sh
npm run check
```

Node.js 20 is the checked-in and CI runtime target. The local machine currently
uses Node.js 22, which also passes. A successful build alone is not sufficient
verification.

## Known operational gotchas

- Pull-request CI intentionally has no workflow-level `concurrency` group. On
  2026-11-11 a GitHub webhook incident left a run in a ghost pre-queue state
  with zero jobs; normal and force cancellation both returned HTTP 409. Because
  every update to one PR has the same `github.ref`, that ghost occupied the old
  concurrency group and prevented later runs from materializing jobs. Do not
  restore PR-level concurrency without first proving the failure mode is gone.
- Google says automatic updates to a published Sheet can take a few minutes.
  The current app fetches its published CSVs only on page load; the target keeps
  the same published-CSV mechanism, so other visitors should expect roughly the
  same delay and must load or refresh after the feed updates. The submitter gets
  an immediate optimistic insertion in the target experience.
- Google lets an individual tab be published, but verify in a signed-out browser
  that only `Published Timeline (Generated)` is accessible.
- Cloudflare's dummy Turnstile success response uses `example.com` and omits the
  action. Use a real free staging widget restricted to the staging/local
  hostnames for end-to-end tests of the Worker's strict hostname/action checks.
- The laptop currently runs Node.js 22.6.0. Wrangler 4.159.0 and newer require
  Node.js 22.12.0 or newer, so the 2026-11-16 staging D1 provisioning used
  Wrangler 4.158.0. Upgrade Node before adopting a newer Wrangler instead of
  ignoring its engine requirement.
- On 2026-11-16 the Turnstile dashboard's **Create** action stalled twice and
  created no widget. `wrangler turnstile widget list` verified the absence of a
  partial or duplicate resource, then authenticated Wrangler 4.158.0 created
  the widget successfully. Check the resource list before retrying a stalled
  dashboard mutation.
- Protecting a Google tab cannot remove edit power from the spreadsheet owner.
  Protect the generated tab from every other editor and clearly mark it as
  generated.
- Required GitHub status checks cannot be selected until the corresponding
  workflow jobs have run at least once.
- A source merge and a live release are separate operations. The production
  reviewer approves each release of the artifact built from protected `master`.
