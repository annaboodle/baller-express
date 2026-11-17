import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  prepareStagingDeploySecrets,
  REQUIRED_STAGING_SECRETS,
} from "../scripts/prepare-staging-deploy-secrets.mjs";

function secretSource(extra = "TURNSTILE_SITE_KEY=public-site-key") {
  return `${REQUIRED_STAGING_SECRETS.map(
    (name, index) =>
      `${name}=${name === "GOOGLE_PRIVATE_KEY" ? '"escaped\\nprivate\\nkey"' : `value-${index}`}`,
  ).join("\n")}\n${extra}\n`;
}

async function fixture(contents = secretSource()) {
  const directory = await mkdtemp(join(tmpdir(), "baller-deploy-secret-test-"));
  const source = join(directory, ".dev.vars");
  const output = join(directory, "local-secrets", "staging-deploy.env");
  await writeFile(source, contents, { mode: 0o600 });
  return { source, output };
}

test("writes exactly the required staging secrets with owner-only permissions", async () => {
  const { source, output } = await fixture();
  await prepareStagingDeploySecrets(source, output);

  const contents = await readFile(output, "utf8");
  const names = contents
    .trimEnd()
    .split("\n")
    .map((line) => line.split("=", 1)[0]);
  assert.deepEqual(names, REQUIRED_STAGING_SECRETS);
  assert.doesNotMatch(contents, /TURNSTILE_SITE_KEY/);
  assert.equal((await stat(output)).mode & 0o777, 0o600);
});

test("rejects a missing, empty, or duplicate required secret", async () => {
  const missingFixture = await fixture(
    secretSource().replace(/^RATE_LIMIT_SECRET=.*\n/m, ""),
  );
  await assert.rejects(
    prepareStagingDeploySecrets(missingFixture.source, missingFixture.output),
    /Missing required staging secrets: RATE_LIMIT_SECRET/,
  );

  const emptyFixture = await fixture(
    secretSource().replace(/^RATE_LIMIT_SECRET=.*$/m, "RATE_LIMIT_SECRET="),
  );
  await assert.rejects(
    prepareStagingDeploySecrets(emptyFixture.source, emptyFixture.output),
    /RATE_LIMIT_SECRET is present but empty/,
  );

  const duplicateFixture = await fixture(
    `${secretSource()}RATE_LIMIT_SECRET=duplicate\n`,
  );
  await assert.rejects(
    prepareStagingDeploySecrets(
      duplicateFixture.source,
      duplicateFixture.output,
    ),
    /RATE_LIMIT_SECRET must be defined exactly once/,
  );
});

test("refuses a symbolic-link source or an existing output", async () => {
  const { source, output } = await fixture();
  const link = `${source}.link`;
  await symlink(source, link);
  await assert.rejects(
    prepareStagingDeploySecrets(link, output),
    /source must be a regular file/,
  );

  await prepareStagingDeploySecrets(source, output);
  await assert.rejects(
    prepareStagingDeploySecrets(source, output),
    /EEXIST/,
  );
});
