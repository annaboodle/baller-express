# The Baller Express

The Baller Express is an unlisted-public React timeline of milestones in a
friend group. The production site is hosted on GitHub Pages.

## Production safety

Source development happens on `codex/protected-submissions`. Production is
served from the separate `gh-pages` branch, and merging source does not deploy
the site.

Do not run `npm run deploy`, modify `gh-pages`, change GitHub Pages settings, or
point local code at writable production resources during development. See
[`AGENTS.md`](AGENTS.md) and
[`docs/submissions.md`](docs/submissions.md) before making changes.

## Frontend development

Install the locked dependencies:

```sh
npm ci
```

Start the local development server:

```sh
npm start
```

The app is available at <http://localhost:3000>.

Run every local check:

```sh
npm run check
```

The individual frontend commands are `npm run test:ci` and `npm run build`.

## Worker foundation

The credential-free Stage 1 Worker scaffold lives in `worker/`. It must remain
fail-closed until isolated staging resources are authorized and configured.

```sh
npm ci --prefix worker
npm --prefix worker run check
npm --prefix worker test
```

No production credentials belong in this repository. Development environment
files are ignored by Git.

## Repository layout

- `src/` — current React frontend.
- `worker/` — submission API foundation and unit tests.
- `.github/workflows/ci.yml` — non-deploying pull-request checks.
- `docs/baseline.md` — verified behavior before submission integration.
- `docs/submissions.md` — staged security, migration, and cutover runbook.
- `AGENTS.md` — maintained project decisions and invariants.

## Deployment

The repository still contains the legacy laptop-driven `npm run deploy`
command because production has not been cut over. It is documented for
historical accuracy, not approved for feature development. A protected,
manual-only replacement is planned for a later explicitly authorized stage.
