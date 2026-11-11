import assert from "node:assert/strict";
import test from "node:test";

import { createSubmissionApp } from "../src/app.js";
import {
  ORIGIN,
  enabledEnv,
  jsonRequest,
  validEditProposal,
  validMilestone,
  validPublicEvent,
} from "./fixtures.js";

function services(overrides = {}) {
  const defaults = {
    rateLimiter: {
      async check() {
        return { allowed: true };
      },
    },
    turnstile: {
      async verify() {
        return { success: true };
      },
    },
    repository: {
      async findReplay() {
        return null;
      },
      async createMilestone() {
        return {
          kind: "created",
          submissionId: "submission-1",
          event: validPublicEvent(),
        };
      },
      async createEditProposal() {
        return { kind: "created", submissionId: "proposal-1" };
      },
    },
  };
  return {
    rateLimiter: { ...defaults.rateLimiter, ...overrides.rateLimiter },
    turnstile: { ...defaults.turnstile, ...overrides.turnstile },
    repository: { ...defaults.repository, ...overrides.repository },
  };
}

async function responseJson(response) {
  return JSON.parse(await response.text());
}

test("fails closed when the emergency switch is not enabled", async () => {
  let rateLimitCalls = 0;
  const app = createSubmissionApp(
    services({
      rateLimiter: {
        async check() {
          rateLimitCalls += 1;
          return { allowed: true };
        },
      },
    }),
  );

  const response = await app.fetch(
    jsonRequest("/v1/milestones", validMilestone()),
    { ALLOWED_ORIGIN: ORIGIN },
  );

  assert.equal(response.status, 503);
  assert.equal(rateLimitCalls, 0);
});

test("fails closed when protection adapters are not configured", async () => {
  const app = createSubmissionApp();
  const response = await app.fetch(
    jsonRequest("/v1/milestones", validMilestone()),
    enabledEnv,
  );
  assert.equal(response.status, 503);
  assert.equal((await responseJson(response)).error.code, "service_unavailable");
});

test("rejects a request from the wrong origin without CORS access", async () => {
  let rateLimitCalls = 0;
  const app = createSubmissionApp(
    services({
      rateLimiter: {
        async check() {
          rateLimitCalls += 1;
          return { allowed: true };
        },
      },
    }),
  );
  const response = await app.fetch(
    jsonRequest("/v1/milestones", validMilestone(), {
      headers: { origin: "https://attacker.example" },
    }),
    enabledEnv,
  );
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(rateLimitCalls, 1);
});

test("handles allowed preflight requests without invoking adapters", async () => {
  const app = createSubmissionApp(services());
  const request = new Request("https://api.example.test/v1/milestones", {
    method: "OPTIONS",
    headers: { origin: ORIGIN },
  });
  const response = await app.fetch(request, enabledEnv);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(
    response.headers.get("access-control-allow-methods"),
    "POST, OPTIONS",
  );
});

test("rejects invalid JSON, oversized bodies, and owner fields", async () => {
  const app = createSubmissionApp(services());

  const invalidJson = await app.fetch(
    jsonRequest("/v1/milestones", "{"),
    enabledEnv,
  );
  const oversized = await app.fetch(
    jsonRequest("/v1/milestones", "x".repeat(16 * 1024 + 1)),
    enabledEnv,
  );
  const ownerField = await app.fetch(
    jsonRequest("/v1/milestones", validMilestone({ hide: "N" })),
    enabledEnv,
  );

  assert.equal(invalidJson.status, 400);
  assert.equal(oversized.status, 413);
  assert.equal(ownerField.status, 400);
  assert.ok(
    (await responseJson(ownerField)).error.fields.some(
      (entry) => entry.field === "hide",
    ),
  );
});

test("rate-limits malformed attempts before parsing, Turnstile, or storage", async () => {
  let verifyCalls = 0;
  let repositoryCalls = 0;
  let rateLimitContext;
  const app = createSubmissionApp(
    services({
      rateLimiter: {
        async check(context) {
          rateLimitContext = context;
          return { allowed: false, retryAfterSeconds: 30 };
        },
      },
      turnstile: {
        async verify() {
          verifyCalls += 1;
          return { success: true };
        },
      },
      repository: {
        async createMilestone() {
          repositoryCalls += 1;
        },
      },
    }),
  );

  const response = await app.fetch(
    jsonRequest("/v1/milestones", "{", {
      headers: { "cf-connecting-ip": "203.0.113.10" },
    }),
    enabledEnv,
  );
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "30");
  assert.equal(verifyCalls, 0);
  assert.equal(repositoryCalls, 0);
  assert.equal(rateLimitContext.sourceIp, "203.0.113.10");
  assert.equal("request" in rateLimitContext, false);
});

test("rejects failed Turnstile verification before storage", async () => {
  let repositoryCalls = 0;
  const app = createSubmissionApp(
    services({
      turnstile: {
        async verify() {
          return { success: false };
        },
      },
      repository: {
        async createMilestone() {
          repositoryCalls += 1;
        },
      },
    }),
  );

  const response = await app.fetch(
    jsonRequest("/v1/milestones", validMilestone()),
    enabledEnv,
  );
  assert.equal(response.status, 403);
  assert.equal(repositoryCalls, 0);
});

test("accepts a valid milestone without passing its token to storage", async () => {
  let verificationContext;
  let storedSubmission;
  let repositoryContext;
  const app = createSubmissionApp(
    services({
      turnstile: {
        async verify(context) {
          verificationContext = context;
          return { success: true };
        },
      },
      repository: {
        async createMilestone(context) {
          repositoryContext = context;
          const { submission } = context;
          storedSubmission = submission;
          return {
            kind: "created",
            submissionId: "submission-1",
            event: validPublicEvent({
              event: submission.description,
              contributorEmail: "private@example.com",
            }),
          };
        },
      },
    }),
  );

  const response = await app.fetch(
    jsonRequest("/v1/milestones", validMilestone()),
    enabledEnv,
  );
  const body = await responseJson(response);

  assert.equal(response.status, 201);
  assert.equal(body.event.event_id, "event-1");
  assert.equal("contributorEmail" in body.event, false);
  assert.equal(verificationContext.expectedAction, "add_milestone");
  assert.equal(verificationContext.expectedHostname, "ballerexpress.com");
  assert.equal(verificationContext.token, "test-turnstile-token");
  assert.equal("turnstileToken" in storedSubmission, false);
  assert.equal("hide" in storedSubmission, false);
  assert.equal("request" in repositoryContext, false);
  assert.deepEqual(repositoryContext.ownerFields, {
    hide: "N",
    source: "public_submission",
  });
});

test("accepts a valid edit proposal and uses its distinct action", async () => {
  let expectedAction;
  let storedSubmission;
  let ownerFields;
  const app = createSubmissionApp(
    services({
      turnstile: {
        async verify(context) {
          expectedAction = context.expectedAction;
          return { success: true };
        },
      },
      repository: {
        async createEditProposal(context) {
          ({ ownerFields } = context);
          const { submission } = context;
          storedSubmission = submission;
          return { kind: "created", submissionId: "proposal-1" };
        },
      },
    }),
  );

  const response = await app.fetch(
    jsonRequest("/v1/edit-proposals", validEditProposal()),
    enabledEnv,
  );
  const body = await responseJson(response);

  assert.equal(response.status, 201);
  assert.equal(body.submissionId, "proposal-1");
  assert.equal("event" in body, false);
  assert.equal(expectedAction, "edit_proposal");
  assert.equal(storedSubmission.original.description, "Alice and Bob met");
  assert.deepEqual(ownerFields, { source: "public_edit_proposal" });
});

test("returns an idempotent replay before reusing a single-use token", async () => {
  let verifyCalls = 0;
  let createCalls = 0;
  const replayApp = createSubmissionApp(
    services({
      turnstile: {
        async verify() {
          verifyCalls += 1;
          return { success: false };
        },
      },
      repository: {
        async findReplay() {
          return {
            kind: "replay",
            submissionId: "submission-1",
            event: validPublicEvent(),
          };
        },
        async createMilestone() {
          createCalls += 1;
        },
      },
    }),
  );

  const replay = await replayApp.fetch(
    jsonRequest("/v1/milestones", validMilestone()),
    enabledEnv,
  );

  assert.equal(replay.status, 200);
  assert.equal(verifyCalls, 0);
  assert.equal(createCalls, 0);
});

test("returns clear duplicate and request-ID conflict outcomes", async () => {
  const duplicateApp = createSubmissionApp(
    services({
      repository: {
        async createMilestone() {
          return { kind: "duplicate" };
        },
      },
    }),
  );
  const conflictApp = createSubmissionApp(
    services({
      repository: {
        async findReplay() {
          return { kind: "conflict" };
        },
      },
    }),
  );
  const duplicate = await duplicateApp.fetch(
    jsonRequest("/v1/milestones", validMilestone()),
    enabledEnv,
  );
  const conflict = await conflictApp.fetch(
    jsonRequest("/v1/milestones", validMilestone()),
    enabledEnv,
  );

  assert.equal(duplicate.status, 409);
  assert.equal(conflict.status, 409);
  assert.equal(
    (await responseJson(duplicate)).error.code,
    "duplicate_submission",
  );
  assert.equal(
    (await responseJson(conflict)).error.code,
    "request_id_conflict",
  );
});

test("does not leak upstream error details", async () => {
  const app = createSubmissionApp(
    services({
      repository: {
        async createMilestone() {
          throw new Error("private storage detail");
        },
      },
    }),
  );
  const response = await app.fetch(
    jsonRequest("/v1/milestones", validMilestone()),
    enabledEnv,
  );
  const text = await response.text();

  assert.equal(response.status, 503);
  assert.equal(text.includes("private storage detail"), false);
});

test("fails closed on malformed repository success records", async () => {
  const malformedCreatedApp = createSubmissionApp(
    services({
      repository: {
        async createMilestone() {
          return {
            kind: "created",
            submissionId: "submission-1",
            event: { event_id: "event-1" },
          };
        },
      },
    }),
  );
  const malformedReplayApp = createSubmissionApp(
    services({
      repository: {
        async findReplay() {
          return { kind: "replay", submissionId: "submission-1" };
        },
      },
    }),
  );

  const created = await malformedCreatedApp.fetch(
    jsonRequest("/v1/milestones", validMilestone()),
    enabledEnv,
  );
  const replay = await malformedReplayApp.fetch(
    jsonRequest("/v1/milestones", validMilestone()),
    enabledEnv,
  );
  assert.equal(created.status, 503);
  assert.equal(replay.status, 503);
});

test("turns request-stream failures into a safe public error", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.error(new Error("private stream detail"));
    },
  });
  const request = new Request("https://api.example.test/v1/milestones", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
    },
    body: stream,
    duplex: "half",
  });
  const response = await createSubmissionApp(services()).fetch(
    request,
    enabledEnv,
  );
  const text = await response.text();

  assert.equal(response.status, 400);
  assert.equal(text.includes("private stream detail"), false);
});

test("returns not-found and method errors without invoking submission logic", async () => {
  const app = createSubmissionApp(services());
  const notFound = await app.fetch(
    new Request("https://api.example.test/unknown"),
    enabledEnv,
  );
  const wrongMethod = await app.fetch(
    new Request("https://api.example.test/v1/milestones", {
      method: "GET",
      headers: { origin: ORIGIN },
    }),
    enabledEnv,
  );
  assert.equal(notFound.status, 404);
  assert.equal(wrongMethod.status, 405);
});
