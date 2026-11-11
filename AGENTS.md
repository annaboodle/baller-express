# Baller Express project guide

Last reviewed: 2026-11-11

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

## Current implementation

This section describes production as it exists before the submission-security
project is deployed.

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

Stage 1 was completed on 2026-11-11 on `codex/protected-submissions`. It is open
as draft pull request [#5](https://github.com/annaboodle/baller-express/pull/5),
is not deployed, and has not changed the production forms, Sheets, `master`,
or `gh-pages`.

- `src/App.test.js` contains four project-specific baseline tests for feed
  merging/sorting, hidden rows, approximate dates, type/people filtering, and
  edit context.
- `.github/workflows/ci.yml` defines read-only, non-deploying pull-request jobs
  for `Frontend tests`, `Frontend production build`, and `Worker tests and
  checks`. All three succeeded in the first real pull-request run on
  2026-11-11.
- `worker/` is a credential-free, fail-closed API foundation with strict request
  validation and mock-adapter tests. It has no Wrangler configuration, cloud
  binding, service credential, or production access.
- `npm run check` passes locally, the owner completed local visual review, and
  draft PR #5 passed all three CI jobs. The owner then enabled those exact jobs
  as required, up-to-date checks on the `Protect master` ruleset. All Stage 1
  gates are complete.

## Approved target architecture

The target workbook has three tabs:

1. `Timeline Source` -- private canonical data edited by the owner and Worker.
2. `Published Timeline (Generated)` -- protected, formula-generated, sanitized,
   and the only tab published to the web.
3. `Edit Proposals` -- private manual-review queue with notification state.

The target submission path is:

`custom React form -> Cloudflare Turnstile -> Cloudflare Worker -> Timeline Source`

- The Worker verifies Turnstile server-side, validates the payload, rate-limits,
  deduplicates, and writes through the Google Sheets API.
- Accepted milestones are written once to `Timeline Source`; the generated tab
  projects only public fields and immediately includes rows whose
  owner-controlled `hide` value is not `Y`.
- Edit proposals are written only to `Edit Proposals` and never auto-apply.
- The website reads one CSV: `Published Timeline (Generated)`.
- The old Google Forms are closed and old published Sheets are unpublished only
  after the new production flow passes smoke tests.

See `docs/submissions.md` for the complete design, staging, GitHub settings,
cutover, and rollback checklist.

## Data and security invariants

- Milestone dates must be on or after `1971-01-01`; future dates are allowed.
- `precise=N` means the displayed date is approximate; preserve this legacy
  semantic unless the data migration deliberately replaces it everywhere.
- `hide=Y` is owner-controlled. Never accept `hide`, publication status,
  timestamps, or canonical IDs from the browser.
- `Published Timeline (Generated)` contains no contributor contact data.
- Turnstile must be verified by the Worker; a client-side widget alone is not a
  trust boundary.
- The Worker fails closed when verification or storage is unavailable.
- Logs omit form payloads, contact details, Turnstile tokens, and raw IPs.
- Write user content to Sheets as literal strings to prevent formula injection.
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
- Production deployment will be a manually triggered GitHub Actions workflow
  that rebuilds protected `master`, reruns checks, and pauses for explicit
  environment approval.
- Remove or disable laptop-driven `npm run deploy` after the replacement
  deployment workflow is verified.
- Do not change the GitHub Pages source or `gh-pages` deployment behavior until
  the manual replacement workflow is ready and the cutover is approved.

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
- Protecting a Google tab cannot remove edit power from the spreadsheet owner.
  Protect the generated tab from every other editor and clearly mark it as
  generated.
- Required GitHub status checks cannot be selected until the corresponding
  workflow jobs have run at least once.
- `master` and `gh-pages` are separate safety boundaries: merging source is not
  deployment, while updating `gh-pages` changes the live site.
