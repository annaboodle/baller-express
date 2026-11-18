import assert from "node:assert/strict";
import test from "node:test";

import { createD1RateLimiter } from "../src/adapters/d1-rate-limiter.js";
import { createD1SheetsRepository } from "../src/adapters/d1-sheets-repository.js";
import { createGoogleAccessTokenProvider } from "../src/adapters/google-auth.js";
import {
  createGoogleSheetsClient,
  SHEET_LAYOUT,
} from "../src/adapters/google-sheets.js";
import { createTurnstileVerifier } from "../src/adapters/turnstile.js";
import { validEditProposal, validMilestone } from "./fixtures.js";

const SECRET = "0123456789abcdef0123456789abcdef";

function stagingEnv(overrides = {}) {
  return {
    RATE_LIMIT_SECRET: SECRET,
    REQUEST_HASH_SECRET: `different-${SECRET}`,
    RATE_LIMIT_WINDOW_SECONDS: "600",
    RATE_LIMIT_MAX_ATTEMPTS: "20",
    RATE_LIMIT_RETENTION_SECONDS: "86400",
    DEDUPE_WINDOW_SECONDS: "600",
    PENDING_STALE_SECONDS: "120",
    GOOGLE_SERVICE_ACCOUNT_EMAIL: "staging@example.iam.gserviceaccount.com",
    GOOGLE_PRIVATE_KEY: "test-private-key",
    GOOGLE_SHEETS_SPREADSHEET_ID: "staging-sheet-id",
    TURNSTILE_SECRET_KEY: "turnstile-test-secret",
    ...overrides,
  };
}

function memoryStore() {
  const requests = new Map();
  const dedupe = new Map();
  return {
    requests,
    dedupe,
    async getRequest({ requestId }) {
      return requests.get(requestId) || null;
    },
    async reserveRequest({ record }) {
      if (requests.has(record.requestId)) return false;
      requests.set(record.requestId, {
        request_id: record.requestId,
        endpoint: record.endpoint,
        payload_hash: record.payloadHash,
        state: "pending",
        submission_id: record.submissionId,
        sheet_name: record.sheetName,
        dedupe_key: record.dedupeKey,
        public_response_json: record.publicResponseJson,
        created_at: record.createdAt,
        completed_at: null,
      });
      return true;
    },
    async completeRequest({ requestId, completedAt }) {
      const row = requests.get(requestId);
      if (!row || row.state !== "pending") return false;
      row.state = "created";
      row.completed_at = completedAt;
      return true;
    },
    async deletePendingRequest({ requestId }) {
      if (requests.get(requestId)?.state === "pending") {
        requests.delete(requestId);
      }
    },
    async acquireDedupe({ dedupeKey, requestId, expiresAt, nowSeconds }) {
      const existing = dedupe.get(dedupeKey);
      if (existing && existing.expiresAt > nowSeconds) {
        return existing.requestId;
      }
      dedupe.set(dedupeKey, { requestId, expiresAt });
      return requestId;
    },
    async releaseDedupe({ dedupeKey, requestId }) {
      if (dedupe.get(dedupeKey)?.requestId === requestId) {
        dedupe.delete(dedupeKey);
      }
    },
  };
}

function fakeSheets() {
  const rows = [];
  const knownSubmissionIds = new Set();
  const knownEventIds = new Set(["event-existing-1"]);
  return {
    rows,
    knownEventIds,
    knownSubmissionIds,
    async appendRow(entry) {
      rows.push(entry);
      const index =
        entry.range === SHEET_LAYOUT.milestone.appendRange ? 10 : 1;
      knownSubmissionIds.add(entry.values[index]);
      return { updates: { updatedRows: 1 } };
    },
    async hasSubmission({ submissionId }) {
      return knownSubmissionIds.has(submissionId);
    },
    async hasEvent({ eventId }) {
      return knownEventIds.has(eventId);
    },
  };
}

function uuidSequence(...values) {
  return () => {
    const value = values.shift();
    if (!value) throw new Error("The UUID fixture is exhausted.");
    return value;
  };
}

test("D1 rate limiting stores a keyed source fingerprint, never the raw IP", async () => {
  const calls = [];
  const limiter = createD1RateLimiter({
    now: () => 1_700_000_000_000,
    hash: async (secret, value) => {
      assert.equal(secret, SECRET);
      assert.equal(value, `/v1/milestones${"\0"}203.0.113.8`);
      return "keyed-source-fingerprint";
    },
    store: {
      async incrementRateWindow(context) {
        calls.push(context);
        return 21;
      },
    },
  });

  const result = await limiter.check({
    env: stagingEnv(),
    endpoint: "/v1/milestones",
    sourceIp: "203.0.113.8",
  });

  assert.equal(result.allowed, false);
  assert.equal(result.retryAfterSeconds > 0, true);
  assert.equal(calls[0].bucketKey, "keyed-source-fingerprint");
  assert.equal(JSON.stringify(calls).includes("203.0.113.8"), false);
});

test("Turnstile accepts only a successful response for the expected action and hostname", async () => {
  const requests = [];
  const verifier = createTurnstileVerifier({
    async fetchImpl(url, init) {
      requests.push({ url, init });
      return new Response(
        JSON.stringify({
          success: true,
          action: "add_milestone",
          hostname: "staging.ballerexpress.test",
        }),
        { status: 200 },
      );
    },
  });

  const valid = await verifier.verify({
    env: stagingEnv(),
    token: "test-token",
    expectedAction: "add_milestone",
    expectedHostname: "staging.ballerexpress.test",
    sourceIp: "203.0.113.8",
  });
  const wrongAction = await verifier.verify({
    env: stagingEnv(),
    token: "test-token",
    expectedAction: "edit_proposal",
    expectedHostname: "staging.ballerexpress.test",
    sourceIp: "203.0.113.8",
  });

  assert.deepEqual(valid, { success: true });
  assert.deepEqual(wrongAction, { success: false });
  const form = new URLSearchParams(requests[0].init.body);
  assert.equal(form.get("secret"), "turnstile-test-secret");
  assert.equal(form.get("response"), "test-token");
  assert.equal(form.get("remoteip"), "203.0.113.8");
});

test("Turnstile fails closed when verification exceeds its timeout", async () => {
  const verifier = createTurnstileVerifier({
    timeoutMs: 5,
    fetchImpl(_url, init) {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      });
    },
  });

  await assert.rejects(
    verifier.verify({
      env: stagingEnv(),
      token: "test-token",
      expectedAction: "add_milestone",
      expectedHostname: "staging.ballerexpress.test",
    }),
    /Turnstile verification was unavailable/,
  );
});

test("Google access tokens use a signed assertion and are cached before expiry", async () => {
  let fetchCalls = 0;
  let signCalls = 0;
  const provider = createGoogleAccessTokenProvider({
    now: () => 1_700_000_000_000,
    async signer(context) {
      signCalls += 1;
      assert.equal(context.email, stagingEnv().GOOGLE_SERVICE_ACCOUNT_EMAIL);
      return "signed-assertion";
    },
    async fetchImpl(url, init) {
      fetchCalls += 1;
      assert.equal(url, "https://oauth2.googleapis.com/token");
      const form = new URLSearchParams(init.body);
      assert.equal(form.get("assertion"), "signed-assertion");
      return new Response(
        JSON.stringify({ access_token: "access-token", expires_in: 3600 }),
        { status: 200 },
      );
    },
  });

  assert.equal(await provider.getToken(stagingEnv()), "access-token");
  assert.equal(await provider.getToken(stagingEnv()), "access-token");
  assert.equal(fetchCalls, 1);
  assert.equal(signCalls, 1);
});

test("Google authentication fails closed when token exchange times out", async () => {
  const provider = createGoogleAccessTokenProvider({
    timeoutMs: 5,
    async signer() {
      return "signed-assertion";
    },
    fetchImpl(_url, init) {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      });
    },
  });

  await assert.rejects(
    provider.getToken(stagingEnv()),
    /Google authentication was unavailable/,
  );
});

test("Google Sheets writes rows as RAW values and can find submission and event IDs", async () => {
  const requests = [];
  const client = createGoogleSheetsClient({
    tokenProvider: { async getToken() { return "access-token"; } },
    async fetchImpl(url, init = {}) {
      requests.push({ url, init });
      if (init.method === "POST") {
        return new Response(
          JSON.stringify({ updates: { updatedRows: 1, updatedColumns: 11 } }),
          { status: 200 },
        );
      }
      const decodedUrl = decodeURIComponent(url);
      if (decodedUrl.includes(SHEET_LAYOUT.milestone.headerRange)) {
        return new Response(
          JSON.stringify({ values: [[...SHEET_LAYOUT.milestone.headers]] }),
          { status: 200 },
        );
      }
      if (decodedUrl.includes(SHEET_LAYOUT.milestone.eventIdRange)) {
        return new Response(
          JSON.stringify({ values: [["event_id"], ["event-existing-1"]] }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({ values: [["submission_id"], ["submission-1"]] }),
        { status: 200 },
      );
    },
  });

  await client.appendRow({
    env: stagingEnv(),
    range: SHEET_LAYOUT.milestone.appendRange,
    values: [
      "event-1",
      "2026-11-11",
      "Y",
      "=literal",
      "Alice, Bob",
      "trip",
      "m",
      "N",
      "public_submission",
      46337.83333333333,
      "submission-1",
      "",
      "",
    ],
  });
  const found = await client.hasSubmission({
    env: stagingEnv(),
    range: SHEET_LAYOUT.milestone.submissionIdRange,
    submissionId: "submission-1",
  });
  const eventFound = await client.hasEvent({
    env: stagingEnv(),
    range: SHEET_LAYOUT.milestone.eventIdRange,
    eventId: "event-existing-1",
  });

  assert.equal(found, true);
  assert.equal(eventFound, true);
  assert.match(requests[1].url, /valueInputOption=RAW/);
  assert.match(requests[1].url, /insertDataOption=OVERWRITE/);
  assert.equal(JSON.parse(requests[1].init.body).values[0].length, 13);
  assert.equal(JSON.parse(requests[1].init.body).values[0][3], "=literal");
  assert.equal(requests[1].init.headers.authorization, "Bearer access-token");
  assert.equal(requests.length, 6);
});

test("Google Sheets rejects schema drift before writing", async () => {
  let postCalls = 0;
  const client = createGoogleSheetsClient({
    tokenProvider: { async getToken() { return "access-token"; } },
    async fetchImpl(_url, init = {}) {
      if (init.method === "POST") postCalls += 1;
      return new Response(JSON.stringify({ values: [["wrong_header"]] }), {
        status: 200,
      });
    },
  });

  await assert.rejects(
    client.appendRow({
      env: stagingEnv(),
      range: SHEET_LAYOUT.milestone.appendRange,
      values: Array(13).fill("fixture"),
    }),
    /schema does not match/,
  );
  assert.equal(postCalls, 0);
});

test("Google Sheets fails closed when a request times out", async () => {
  const client = createGoogleSheetsClient({
    timeoutMs: 5,
    tokenProvider: { async getToken() { return "access-token"; } },
    fetchImpl(_url, init) {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      });
    },
  });

  await assert.rejects(
    client.appendRow({
      env: stagingEnv(),
      range: SHEET_LAYOUT.milestone.appendRange,
      values: Array(13).fill("fixture"),
    }),
    /schema check failed/,
  );
});

test("repository writes exactly Timeline Source A:M and returns only public fields", async () => {
  const store = memoryStore();
  const sheets = fakeSheets();
  const repository = createD1SheetsRepository({
    store,
    sheets,
    now: () => Date.parse("2026-11-11T20:00:00.000Z"),
    randomUuid: uuidSequence("submission-uuid", "event-uuid"),
  });
  const submission = validMilestone({
    description: '=IMPORTDATA("https://example.test")',
  });

  const result = await repository.createMilestone({
    endpoint: "/v1/milestones",
    env: stagingEnv(),
    ownerFields: { hide: "N", source: "public_submission" },
    submission,
  });

  assert.equal(result.kind, "created");
  assert.equal(result.submissionId, "submission-submission-uuid");
  assert.equal(result.event.event_id, "event-event-uuid");
  assert.equal("contributorEmail" in result.event, false);
  assert.equal(sheets.rows.length, 1);
  assert.equal(sheets.rows[0].range, "Timeline Source!A:M");
  assert.deepEqual(sheets.rows[0].values, [
    "event-event-uuid",
    "2026-11-11",
    "Y",
    '=IMPORTDATA("https://example.test")',
    "Alice, Bob",
    "trip",
    "m",
    "N",
    "public_submission",
    46337.83333333333,
    "submission-submission-uuid",
    "Test Contributor",
    "test@example.com",
  ]);
  assert.equal(sheets.rows[0].values.length, 13);
  const record = store.requests.get(submission.requestId);
  assert.equal(record.state, "created");
  assert.equal(record.public_response_json.includes("test@example.com"), false);
});

test("repository writes exactly Edit Proposals A:M with immutable event reference", async () => {
  const sheets = fakeSheets();
  const repository = createD1SheetsRepository({
    store: memoryStore(),
    sheets,
    now: () => Date.parse("2026-11-11T20:00:00.000Z"),
    randomUuid: uuidSequence("submission-uuid", "proposal-uuid"),
  });

  const result = await repository.createEditProposal({
    endpoint: "/v1/edit-proposals",
    env: stagingEnv(),
    ownerFields: { source: "public_edit_proposal" },
    submission: validEditProposal(),
  });

  assert.deepEqual(result, {
    kind: "created",
    submissionId: "submission-submission-uuid",
  });
  assert.equal(sheets.rows[0].range, "Edit Proposals!A:M");
  assert.deepEqual(sheets.rows[0].values, [
    "proposal-proposal-uuid",
    "submission-submission-uuid",
    "public_edit_proposal",
    46337.83333333333,
    "event-existing-1",
    "2020-01-02",
    "Alice and Bob met",
    "Alice, Bob",
    "description",
    "Clarify where they met.",
    "",
    "",
    "PENDING",
  ]);
  assert.equal(sheets.rows[0].values.length, 13);
});

test("repository rejects an edit proposal whose target event does not exist", async () => {
  const store = memoryStore();
  const sheets = fakeSheets();
  sheets.knownEventIds.clear();
  const repository = createD1SheetsRepository({
    store,
    sheets,
    randomUuid: uuidSequence("unused-submission", "unused-proposal"),
  });

  const result = await repository.createEditProposal({
    endpoint: "/v1/edit-proposals",
    env: stagingEnv(),
    ownerFields: { source: "public_edit_proposal" },
    submission: validEditProposal(),
  });

  assert.deepEqual(result, { kind: "event_not_found" });
  assert.equal(sheets.rows.length, 0);
  assert.equal(store.requests.size, 0);
  assert.equal(store.dedupe.size, 0);
});

test("repository replays one request and rejects a changed request ID payload", async () => {
  const store = memoryStore();
  const sheets = fakeSheets();
  const repository = createD1SheetsRepository({
    store,
    sheets,
    now: () => Date.parse("2026-11-11T20:00:00.000Z"),
    randomUuid: uuidSequence("submission-uuid", "event-uuid"),
  });
  const submission = validMilestone();
  const context = {
    endpoint: "/v1/milestones",
    env: stagingEnv(),
    ownerFields: { hide: "N", source: "public_submission" },
    submission,
  };
  const created = await repository.createMilestone(context);
  const replayed = await repository.findReplay(context);
  const conflict = await repository.findReplay({
    ...context,
    submission: { ...submission, description: "Different content" },
  });

  assert.equal(created.kind, "created");
  assert.deepEqual(replayed, {
    kind: "replay",
    submissionId: created.submissionId,
    event: created.event,
  });
  assert.deepEqual(conflict, { kind: "conflict" });
  assert.equal(sheets.rows.length, 1);
});

test("repository collapses a three-request bot burst despite changed IDs and contact", async () => {
  const store = memoryStore();
  const sheets = fakeSheets();
  const repository = createD1SheetsRepository({
    store,
    sheets,
    now: () => Date.parse("2026-11-11T20:00:00.000Z"),
    randomUuid: uuidSequence(
      "submission-one",
      "event-one",
      "submission-two",
      "event-two",
      "submission-three",
      "event-three",
    ),
  });
  const first = validMilestone();
  const second = validMilestone({
    requestId: "323e4567-e89b-42d3-a456-426614174000",
    turnstileToken: "different-single-use-token",
    contributorName: "Different Contributor",
    contributorEmail: "different@example.com",
  });
  const third = validMilestone({
    requestId: "423e4567-e89b-42d3-a456-426614174000",
    turnstileToken: "third-single-use-token",
    contributorName: "Third Contributor",
    contributorEmail: "third@example.com",
  });
  const base = {
    endpoint: "/v1/milestones",
    env: stagingEnv(),
    ownerFields: { hide: "N", source: "public_submission" },
  };

  assert.equal(
    (await repository.createMilestone({ ...base, submission: first })).kind,
    "created",
  );
  assert.deepEqual(
    await repository.createMilestone({ ...base, submission: second }),
    { kind: "duplicate" },
  );
  assert.deepEqual(
    await repository.createMilestone({ ...base, submission: third }),
    { kind: "duplicate" },
  );
  assert.equal(sheets.rows.length, 1);
  assert.equal(store.requests.has(second.requestId), false);
  assert.equal(store.requests.has(third.requestId), false);
});

test("repository preserves a pending reservation after an uncertain Sheets failure", async () => {
  const store = memoryStore();
  const repository = createD1SheetsRepository({
    store,
    sheets: {
      async appendRow() {
        throw new Error("staging Sheets unavailable");
      },
      async hasSubmission() {
        return false;
      },
    },
    randomUuid: uuidSequence("submission-uuid", "event-uuid"),
  });
  const submission = validMilestone();

  await assert.rejects(
    repository.createMilestone({
      endpoint: "/v1/milestones",
      env: stagingEnv(),
      ownerFields: { hide: "N", source: "public_submission" },
      submission,
    }),
    /staging Sheets unavailable/,
  );
  assert.equal(store.requests.get(submission.requestId).state, "pending");
  assert.equal(store.dedupe.size, 1);
});

test("repository reconciles a pending D1 record after a successful Sheets append", async () => {
  const store = memoryStore();
  const sheets = fakeSheets();
  const submission = validMilestone();
  store.requests.set(submission.requestId, {
    request_id: submission.requestId,
    endpoint: "/v1/milestones",
    payload_hash: "fixture-hash",
    state: "pending",
    submission_id: "submission-existing",
    sheet_name: "Timeline Source",
    dedupe_key: "/v1/milestones:fixture-hash",
    public_response_json: JSON.stringify({
      event_id: "event-existing",
      date: "2026-11-11",
      precise: "Y",
      event: "A test trip",
      people: "Alice, Bob",
      type: "trip",
      size: "m",
    }),
    created_at: 1_700_000_000,
    completed_at: null,
  });
  sheets.knownSubmissionIds.add("submission-existing");
  const repository = createD1SheetsRepository({
    store,
    sheets,
    now: () => 1_700_000_001_000,
    hash: async () => "fixture-hash",
  });

  const result = await repository.findReplay({
    endpoint: "/v1/milestones",
    env: stagingEnv(),
    submission,
  });

  assert.equal(result.kind, "replay");
  assert.equal(result.submissionId, "submission-existing");
  assert.equal(store.requests.get(submission.requestId).state, "created");
});

test("repository releases a stale pending request only after Sheets confirms it is absent", async () => {
  const store = memoryStore();
  const sheets = fakeSheets();
  const submission = validMilestone();
  store.requests.set(submission.requestId, {
    request_id: submission.requestId,
    endpoint: "/v1/milestones",
    payload_hash: "fixture-hash",
    state: "pending",
    submission_id: "submission-missing",
    sheet_name: "Timeline Source",
    dedupe_key: "/v1/milestones:fixture-hash",
    public_response_json: JSON.stringify({
      event_id: "event-missing",
      date: "2026-11-11",
      precise: "Y",
      event: "A test trip",
      people: "Alice, Bob",
      type: "trip",
      size: "m",
    }),
    created_at: 1_700_000_000,
    completed_at: null,
  });
  store.dedupe.set("/v1/milestones:fixture-hash", {
    requestId: submission.requestId,
    expiresAt: 1_700_000_600,
  });
  const repository = createD1SheetsRepository({
    store,
    sheets,
    now: () => 1_700_000_121_000,
    hash: async () => "fixture-hash",
  });

  const result = await repository.findReplay({
    endpoint: "/v1/milestones",
    env: stagingEnv(),
    submission,
  });

  assert.equal(result, null);
  assert.equal(store.requests.has(submission.requestId), false);
  assert.equal(store.dedupe.size, 0);
});
