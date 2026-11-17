import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { generateStagingKeyedSecrets } from "../scripts/generate-staging-keyed-secrets.mjs";

const NAMES = [
  "RATE_LIMIT_SECRET",
  "REQUEST_HASH_SECRET",
  "ALERT_POLL_SECRET",
];

async function fixture(contents = "EXISTING=value\n") {
  const directory = await mkdtemp(join(tmpdir(), "baller-secret-test-"));
  const path = join(directory, ".dev.vars");
  await writeFile(path, contents, { mode: 0o600 });
  return path;
}

function generatedValue(name) {
  return `${name.replaceAll("_", "-")}-0123456789abcdefghijklmnopqrstuvwxyz`;
}

test("generates missing independent values without changing existing content", async () => {
  const path = await fixture();
  const generated = await generateStagingKeyedSecrets(path, generatedValue);
  const contents = await readFile(path, "utf8");
  const mode = (await stat(path)).mode & 0o777;

  assert.deepEqual(generated, NAMES);
  assert.match(contents, /^EXISTING=value\n/);
  for (const name of NAMES) {
    assert.match(contents, new RegExp(`^${name}=${generatedValue(name)}$`, "m"));
  }
  assert.equal(mode, 0o600);
});

test("is idempotent and accepts matched quotes", async () => {
  const contents = NAMES.map(
    (name, index) =>
      `${name}=${index % 2 ? "'" : '\"'}${generatedValue(name)}${
        index % 2 ? "'" : '\"'
      }`,
  ).join("\n");
  const path = await fixture(`${contents}\n`);
  const before = await readFile(path, "utf8");

  assert.deepEqual(await generateStagingKeyedSecrets(path), []);
  assert.equal(await readFile(path, "utf8"), before);
});

for (const [label, definition, message] of [
  ["empty", "RATE_LIMIT_SECRET=", /present but empty/],
  ["short", "RATE_LIMIT_SECRET=too-short", /at least 32 base64url/],
  [
    "placeholder",
    "RATE_LIMIT_SECRET=REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS",
    /not a placeholder/,
  ],
  [
    "duplicate",
    `${NAMES[0]}=${generatedValue(NAMES[0])}\n${NAMES[0]}=${generatedValue(
      NAMES[1],
    )}`,
    /defined exactly once/,
  ],
  [
    "mismatched quotes",
    `RATE_LIMIT_SECRET=\"${generatedValue(NAMES[0])}'`,
    /mismatched quotes/,
  ],
]) {
  test(`rejects ${label} existing values`, async () => {
    const path = await fixture(`${definition}\n`);
    await assert.rejects(
      generateStagingKeyedSecrets(path, generatedValue),
      message,
    );
  });
}

test("rejects a symbolic-link target", async () => {
  const target = await fixture();
  const link = `${target}.link`;
  await symlink(target, link);

  await assert.rejects(
    generateStagingKeyedSecrets(link, generatedValue),
    /must be a regular file/,
  );
});

test("rejects a generator that returns duplicate values", async () => {
  const path = await fixture();
  const repeated = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFG";

  await assert.rejects(
    generateStagingKeyedSecrets(path, () => repeated),
    /must be independent/,
  );
});
