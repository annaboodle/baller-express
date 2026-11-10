# Baller Express project guide

Last reviewed: 2026-11-09

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
- New milestones are intended to publish immediately after server acceptance.
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

## Approved direction (not yet implemented)

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
  projects only public fields and excludes `hide=Y` rows.
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
npm install
npm start
```

Current checks:

```sh
CI=true npm test -- --watchAll=false
npm run build
```

The existing test is a stale Create React App starter test and must be replaced
as part of the submission-security work. A successful build alone is not
sufficient verification.

## Known operational gotchas

- Google published data can take a few minutes to refresh. Accepted milestones
  should be inserted optimistically for the submitter.
- Google lets an individual tab be published, but verify in a signed-out browser
  that only `Published Timeline (Generated)` is accessible.
- Protecting a Google tab cannot remove edit power from the spreadsheet owner.
  Protect the generated tab from every other editor and clearly mark it as
  generated.
- Required GitHub status checks cannot be selected until the corresponding
  workflow jobs have run at least once.
- `master` and `gh-pages` are separate safety boundaries: merging source is not
  deployment, while updating `gh-pages` changes the live site.
