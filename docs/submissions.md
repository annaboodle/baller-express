# Submission security and deployment runbook

Status: reconciled proposed design; implementation awaits Stage 1 approval

Last reviewed: 2026-11-09

## Production safety rule

The current website must remain unchanged throughout development and local
review. Do not modify the current production Forms, published spreadsheets,
GitHub Pages source, or `gh-pages` branch until the final cutover checklist is
explicitly approved.

Verified repository state on 2026-11-09:

- GitHub Pages uses the root of `gh-pages` with the legacy branch deployment.
- `master` contains source and does not deploy automatically.
- There is no GitHub Actions workflow.
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

Private canonical timeline. Expected fields include the public event fields plus
`event_id`, `hide`, `source`, `submitted_at`, `submission_id`, and optional
private contributor name/email.

For a valid new milestone, the Worker appends one row with the owner-controlled
default `hide=N`. It never accepts `hide` from the browser. The row therefore
flows into the generated public tab immediately and can be hidden later by the
owner if needed.

Historical master events use a source such as `legacy_master` and may have blank
submission/contact metadata. Migrated legitimate form events use
`legacy_submission`.

### Published Timeline (Generated)

Generated projection of visible rows from `Timeline Source`. Publish only this
tab and protect it from every editor except the spreadsheet owner. The website
reads only its CSV.

Expected public fields are `event_id`, `date`, `precise`, `event`, `people`,
`type`, and `size`. Do not include contributor contact data or submission
metadata.

### Edit Proposals

Private queue containing the original milestone reference, requested fields,
requested change, optional contributor contact data, timestamps, and email
notification status.

## Development isolation

All implementation work occurs on `codex/protected-submissions`.

Local development uses:

- Frontend at `http://localhost:3000`.
- Worker at `http://localhost:8787`.
- Cloudflare Turnstile test keys.
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

- Install the existing dependencies, run the current checked-out frontend on a
  local development server, and document its baseline behavior before changing
  it. The source code is already local; nothing is being recreated.
- Replace the stale starter test with meaningful baseline coverage.
- Scaffold the Worker, request contracts, validation, and tests without cloud
  credentials or writable external resources.
- Add non-deploying pull-request CI for tests and production builds.
- Gate: local behavior is reviewed, all checks pass, and production remains
  untouched. Then add the proven checks to the `master` ruleset.

### Stage 2: isolated staging backend and workbook

- Create a separate three-tab staging workbook containing only test or
  sanitized fixture data.
- Configure free Turnstile test/staging settings, a staging Worker, D1
  deduplication/rate-limit state, validation, the kill switch, and safe logs.
- Select and test free notification and usage-alert mechanisms. Do not assume a
  Sheets API write will invoke a Google Form or `onEdit` trigger; an explicit
  mechanism such as a time-driven Apps Script poller must be used if Apps Script
  handles notifications.
- Gate: privacy, storage, security, notification, and high-usage-alert tests
  pass without publishing PII or touching production data.

### Stage 3: local frontend integration

- Replace direct Google Form posts in the feature branch with the staging API.
- Conditionally mount the forms, add Turnstile, validation, loading/error
  states, retry-safe request IDs, and immediate milestone-publication UX.
- Gate: owner reviews desktop and mobile behavior locally; production still
  uses the old frontend and endpoints.

### Stage 4: migration rehearsal

- Export backups and run a dry-run consolidation into staging.
- Report source counts, generated IDs, hidden rows, excluded `05/31/1970` spam,
  legitimate legacy submissions, and the exact public schema.
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

**Completed 2026-11-09:** the active ruleset **Protect master** applies to one
target, `master`. Its bypass list is empty. It restricts deletion, requires a
pull request with zero required approvals and conversation resolution, and
blocks force pushes. Required status checks remain off until the CI jobs exist.

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
10. Leave **Require status checks to pass** off until the CI jobs exist and have
    run at least once.
11. Keep **Block force pushes** on.
12. Leave code scanning, code quality, code coverage, and automatic Copilot
    review rules off for now.
13. Review the rule and select **Create**.

Do not enable required status checks yet; the workflow jobs do not exist and
GitHub cannot select them until they have run.

## GitHub settings: do after CI exists

After the pull-request workflow has run successfully at least once:

1. Reopen the `master` protection rule.
2. Enable **Require status checks to pass before merging**.
3. Require uniquely named jobs for frontend tests, frontend production build,
   Worker tests/typecheck, and secret/config validation.
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
4. Exclude hidden rows and the confirmed `05/31/1970` bot submissions; review
   migration counts before writing.
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
  upgrade.
- Avoid attaching a Google billing account; if a future Google requirement
  makes that unavoidable, stop and obtain explicit owner approval.
- Alert on 100 attempts in 10 minutes, 1,000 attempts in 24 hours, 50 accepted
  submissions in 24 hours, or repeated upstream failures.
- Prefer safe submission failure over paid overage or silent degradation.
