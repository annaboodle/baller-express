# Current frontend baseline

Captured: 2026-11-11

This document records the existing local behavior before the submission system
is integrated. It does not describe the future Worker-backed forms.

## Environment and commands

- Local runtime observed: Node.js 22.6.0 and npm 10.8.2.
- Pull-request CI is configured to use Node.js 20.
- Dependencies were already installed from the committed lockfile.
- `npm run build` completed successfully. The build emitted only the existing
  outdated Browserslist database warning.
- `npm start` compiled successfully and `http://127.0.0.1:3000` returned HTTP
  200.
- The original `src/App.test.js` failed because it was the untouched Create
  React App starter assertion for a deleted “Learn React” link. Stage 1 replaced
  that placeholder with project-specific baseline tests.
- `npm run check` now passes four frontend tests, the optimized frontend build,
  Worker syntax checks, and 23 Worker tests.
- The only remaining command warnings are dependency/tooling notices from the
  older Create React App stack: Node's `punycode` deprecation and an outdated
  Browserslist database. Neither fails the build.

The in-app browser host was unavailable during the first visual-QA attempt.
Automated DOM tests and build checks continue, but desktop/mobile visual review
remains a Stage 1 gate rather than being treated as complete.

## Existing runtime behavior

- On initial mount, the browser downloads a curated timeline CSV and a submitted
  milestone CSV, sequentially.
- It excludes submitted rows with `hide=Y`, merges both datasets, sorts newest
  first, derives people/type filters, and replaces the loading indicator with
  timeline cards.
- Timeline cards show a formatted date, description, people/avatar list, and an
  edit control.
- Filters can include/exclude milestone types and people and can switch between
  matching any selected person and matching all selected people.
- Selecting a timeline edit control prepopulates the milestone reference used
  by the edit form.
- The add and edit forms currently post directly to Google Forms. Both forms are
  mounted even when their CSS-hidden modals are closed; this is existing
  behavior and a confirmed abuse vector, not the target design.
- Published CSVs are fetched only on page load. Other visitors must load or
  refresh after Google republishes a change.

## Stage 1 boundary

Stage 1 may add baseline tests, non-deploying CI, documentation, and a
credential-free fail-closed Worker scaffold. It does not replace the current
forms, change the live frontend, create cloud resources, access production
Sheets, or deploy anything.
