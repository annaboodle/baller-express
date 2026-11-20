import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  normalizeWorkerOrigin,
  parseArguments,
  readTurnstileSiteKey,
} from "../scripts/serve-staging-smoke.mjs";

test("accepts only a path-free workers.dev staging origin", () => {
  assert.equal(
    normalizeWorkerOrigin("https://stage.example-account.workers.dev"),
    "https://stage.example-account.workers.dev",
  );
  assert.deepEqual(
    parseArguments([
      "--worker-origin",
      "https://stage.example-account.workers.dev",
    ]),
    { workerOrigin: "https://stage.example-account.workers.dev" },
  );

  for (const invalid of [
    "http://stage.example-account.workers.dev",
    "https://ballerexpress.com",
    "https://stage.example-account.workers.dev/path",
    "https://stage.example-account.workers.dev?query=yes",
    "https://user@stage.example-account.workers.dev",
  ]) {
    assert.throws(() => normalizeWorkerOrigin(invalid), /workers\.dev staging origin/);
  }
  assert.throws(() => parseArguments([]), /worker-origin is required/);
  assert.throws(
    () =>
      parseArguments([
        "--worker-origin=https://one.example.workers.dev",
        "--worker-origin=https://two.example.workers.dev",
      ]),
    /exactly once/,
  );
});

test("reads only the public Turnstile site key from owner-only local variables", async () => {
  const directory = await mkdtemp(join(tmpdir(), "baller-smoke-harness-test-"));
  const path = join(directory, ".dev.vars");
  await writeFile(
    path,
    [
      "TURNSTILE_SECRET_KEY=do-not-expose",
      'GOOGLE_PRIVATE_KEY="escaped\\nprivate\\nkey"',
      'TURNSTILE_SITE_KEY="0x4AAAAAAAAAAAAAAAAAAAAAAA"',
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  assert.equal(
    await readTurnstileSiteKey(path),
    "0x4AAAAAAAAAAAAAAAAAAAAAAA",
  );

  await chmod(path, 0o644);
  await assert.rejects(readTurnstileSiteKey(path), /owner-readable only/);
});

test("browser harness pins actions and contains no token logging", async () => {
  const source = await readFile(
    resolve("staging-smoke/app.js"),
    "utf8",
  );
  assert.match(source, /renderWidget\("milestone",[^\n]+"add_milestone"\)/);
  assert.match(source, /renderWidget\("edit",[^\n]+"edit_proposal"\)/);
  assert.doesNotMatch(source, /console\s*\./);
  assert.doesNotMatch(source, /localStorage|sessionStorage|clipboard/i);
  assert.match(source, /request\.turnstileToken = ""/);
  assert.match(source, /body\.turnstileToken = ""/);
});
