import assert from "node:assert/strict";
import test from "node:test";

import { createSubmissionApp } from "../src/app.js";
import {
  UPSTREAM_FAILURE_CATEGORIES,
  UpstreamDependencyError,
} from "../src/adapters/upstream-error.js";
import { createRuntimeApp } from "../src/runtime.js";
import {
  enabledEnv,
  jsonRequest,
  validMilestone,
  validPublicEvent,
} from "./fixtures.js";

function executionContext() {
  const tasks = [];
  return {
    waitUntil(task) {
      tasks.push(task);
    },
    async flush() {
      await Promise.all(tasks);
    },
  };
}

function telemetrySpy(overrides = {}) {
  const calls = [];
  return {
    calls,
    async recordAttempt(context) {
      calls.push({ method: "attempt", context });
    },
    async recordAccepted(context) {
      calls.push({ method: "accepted", context });
    },
    async recordFailure(context) {
      calls.push({ method: "failure", context });
    },
    async cleanup(context) {
      calls.push({ method: "cleanup", context });
    },
    ...overrides,
  };
}

function services(overrides = {}) {
  return {
    rateLimiter: {
      async check() {
        return { allowed: true };
      },
      ...overrides.rateLimiter,
    },
    turnstile: {
      async verify() {
        return { success: true };
      },
      ...overrides.turnstile,
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
        return { kind: "created", submissionId: "submission-2" };
      },
      ...overrides.repository,
    },
  };
}

test("kill switch prevents telemetry work and a new milestone records attempt and acceptance", async () => {
  const telemetry = telemetrySpy();
  const app = createSubmissionApp({ ...services(), telemetry });
  const disabledContext = executionContext();
  const disabled = await app.fetch(
    jsonRequest("/v1/milestones", validMilestone()),
    { ALLOWED_ORIGIN: enabledEnv.ALLOWED_ORIGIN },
    disabledContext,
  );
  await disabledContext.flush();
  assert.equal(disabled.status, 503);
  assert.deepEqual(telemetry.calls, []);

  const enabledContext = executionContext();
  const created = await app.fetch(
    jsonRequest("/v1/milestones", validMilestone()),
    enabledEnv,
    enabledContext,
  );
  await enabledContext.flush();
  assert.equal(created.status, 201);
  assert.deepEqual(
    telemetry.calls.map((entry) => entry.method),
    ["attempt", "accepted"],
  );
});

test("replays and normal Turnstile rejections count attempts but not accepted submissions or upstream failures", async () => {
  const replayTelemetry = telemetrySpy();
  const replayApp = createSubmissionApp({
    ...services({
      repository: {
        async findReplay() {
          return {
            kind: "replay",
            submissionId: "submission-1",
            event: validPublicEvent(),
          };
        },
      },
    }),
    telemetry: replayTelemetry,
  });
  const replayContext = executionContext();
  const replay = await replayApp.fetch(
    jsonRequest("/v1/milestones", validMilestone()),
    enabledEnv,
    replayContext,
  );
  await replayContext.flush();
  assert.equal(replay.status, 200);
  assert.deepEqual(
    replayTelemetry.calls.map((entry) => entry.method),
    ["attempt"],
  );

  const rejectedTelemetry = telemetrySpy();
  const rejectedApp = createSubmissionApp({
    ...services({
      turnstile: {
        async verify() {
          return { success: false };
        },
      },
    }),
    telemetry: rejectedTelemetry,
  });
  const rejectedContext = executionContext();
  const rejected = await rejectedApp.fetch(
    jsonRequest("/v1/milestones", validMilestone()),
    enabledEnv,
    rejectedContext,
  );
  await rejectedContext.flush();
  assert.equal(rejected.status, 403);
  assert.deepEqual(
    rejectedTelemetry.calls.map((entry) => entry.method),
    ["attempt"],
  );
});

test("typed upstream failures record only their coarse alert category", async () => {
  const replayTelemetry = telemetrySpy();
  const replayApp = createSubmissionApp({
    ...services({
      repository: {
        async findReplay() {
          throw new UpstreamDependencyError(
            UPSTREAM_FAILURE_CATEGORIES.sheets,
            "private replay lookup detail",
          );
        },
      },
    }),
    telemetry: replayTelemetry,
  });
  const replayContext = executionContext();
  const replayResponse = await replayApp.fetch(
    jsonRequest("/v1/milestones", validMilestone()),
    enabledEnv,
    replayContext,
  );
  await replayContext.flush();
  assert.equal(replayResponse.status, 503);
  assert.deepEqual(
    replayTelemetry.calls.map((entry) => [
      entry.method,
      entry.context.category,
    ]),
    [
      ["attempt", undefined],
      ["failure", "sheets"],
    ],
  );

  const turnstileTelemetry = telemetrySpy();
  const turnstileApp = createSubmissionApp({
    ...services({
      turnstile: {
        async verify() {
          throw new UpstreamDependencyError(
            UPSTREAM_FAILURE_CATEGORIES.turnstile,
            "private Turnstile detail",
          );
        },
      },
    }),
    telemetry: turnstileTelemetry,
  });
  const turnstileContext = executionContext();
  const turnstileResponse = await turnstileApp.fetch(
    jsonRequest("/v1/milestones", validMilestone()),
    enabledEnv,
    turnstileContext,
  );
  await turnstileContext.flush();
  assert.equal(turnstileResponse.status, 503);
  assert.deepEqual(
    turnstileTelemetry.calls.map((entry) => [
      entry.method,
      entry.context.category,
    ]),
    [
      ["attempt", undefined],
      ["failure", "turnstile"],
    ],
  );

  const googleTelemetry = telemetrySpy();
  const googleApp = createSubmissionApp({
    ...services({
      repository: {
        async createMilestone() {
          throw new UpstreamDependencyError(
            UPSTREAM_FAILURE_CATEGORIES.googleAuth,
            "private OAuth detail",
          );
        },
      },
    }),
    telemetry: googleTelemetry,
  });
  const googleContext = executionContext();
  const googleResponse = await googleApp.fetch(
    jsonRequest("/v1/milestones", validMilestone()),
    enabledEnv,
    googleContext,
  );
  await googleContext.flush();
  assert.equal(googleResponse.status, 503);
  assert.deepEqual(
    googleTelemetry.calls.map((entry) => [
      entry.method,
      entry.context.category,
    ]),
    [
      ["attempt", undefined],
      ["failure", "google_auth"],
    ],
  );

  const sheetsTelemetry = telemetrySpy();
  const sheetsApp = createSubmissionApp({
    ...services({
      repository: {
        async createMilestone() {
          throw new UpstreamDependencyError(
            UPSTREAM_FAILURE_CATEGORIES.sheets,
            "private Sheets detail",
          );
        },
      },
    }),
    telemetry: sheetsTelemetry,
  });
  const sheetsContext = executionContext();
  const sheetsResponse = await sheetsApp.fetch(
    jsonRequest("/v1/milestones", validMilestone()),
    enabledEnv,
    sheetsContext,
  );
  await sheetsContext.flush();
  assert.equal(sheetsResponse.status, 503);
  assert.deepEqual(
    sheetsTelemetry.calls.map((entry) => [
      entry.method,
      entry.context.category,
    ]),
    [
      ["attempt", undefined],
      ["failure", "sheets"],
    ],
  );
});

test("telemetry delivery failures never reverse a stored submission", async () => {
  const telemetry = telemetrySpy({
    async recordAttempt() {
      throw new Error("telemetry unavailable");
    },
    async recordAccepted() {
      throw new Error("telemetry unavailable");
    },
  });
  const app = createSubmissionApp({ ...services(), telemetry });
  const context = executionContext();
  const response = await app.fetch(
    jsonRequest("/v1/milestones", validMilestone()),
    enabledEnv,
    context,
  );
  await context.flush();
  assert.equal(response.status, 201);
});

test("runtime routes internal alert endpoints outside the public submission app", async () => {
  let internalCalls = 0;
  const telemetry = telemetrySpy();
  const runtime = createRuntimeApp({
    ...services(),
    telemetry,
    internalAlerts: {
      async handle() {
        internalCalls += 1;
        return new Response(null, { status: 204 });
      },
    },
  });

  const response = await runtime.fetch(
    new Request("https://staging.invalid/internal/v1/alerts/lease", {
      method: "POST",
      body: "{}",
    }),
    {},
  );
  assert.equal(response.status, 204);
  assert.equal(internalCalls, 1);
  assert.deepEqual(telemetry.calls, []);
});
