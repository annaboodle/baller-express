import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const codeUrl = new URL("../apps-script/Code.gs", import.meta.url);

test("Apps Script is credential-free and pins the private A:Q contract", async () => {
  const source = await readFile(codeUrl, "utf8");
  assert.match(source, /"original_event_id"/);
  assert.match(source, /getRange\(index \+ 2, 13, 1, 2\)/);
  assert.match(source, /BALLER_MAIL_QUOTA_RESERVE_ = 10/);
  assert.match(source, /BALLER_PROPOSAL_MAX_ATTEMPTS_ = 8/);
  assert.match(source, /status !== "PENDING" && status !== "RETRY"/);
  assert.match(source, /setValue\("RETRY"\)/);
  assert.match(source, /computeHmacSha256Signature/);
  assert.match(source, /tryLock\(1000\)/);
  assert.equal(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(source),
    false,
  );
  assert.equal(source.includes("REPLACE_WITH"), false);
});

test("Apps Script retains only coarse retry and health state", async () => {
  const source = await readFile(codeUrl, "utf8");
  for (const forbiddenProperty of [
    "CONTRIBUTOR_EMAIL",
    "FORM_PAYLOAD",
    "RAW_ERROR",
    "SOURCE_IP",
    "TURNSTILE_TOKEN",
  ]) {
    assert.equal(source.includes(forbiddenProperty), false);
  }
  assert.match(source, /consecutiveFailures/);
  assert.match(source, /nextAttemptAt/);
  assert.match(source, /BALLER_DELIVERED_ALERTS_KEY_/);
  assert.match(source, /BALLER_DELIVERED_PROPOSALS_KEY_/);
});
