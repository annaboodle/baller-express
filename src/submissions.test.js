import {
  createRequestId,
  createSubmissionApi,
  dateSortKey,
  formatTimelineDate,
  getSubmissionConfig,
  normalizePeople,
  parsePeople,
  SubmissionError,
  toIsoDate,
} from "./submissions";

const ENV = {
  REACT_APP_STAGE3_WORKER_ORIGIN: "https://stage-example.workers.dev",
  REACT_APP_STAGE3_TURNSTILE_SITE_KEY: "public-site-key",
};

const CONFIG = {
  available: true,
  apiOrigin: "https://stage-example.workers.dev",
  siteKey: "public-site-key",
};

function response({ ok = true, status = 200, body, retryAfter }) {
  return {
    ok,
    status,
    json: jest.fn().mockResolvedValue(body),
    headers: {
      get: jest.fn((name) =>
        name.toLowerCase() === "retry-after" ? retryAfter || null : null,
      ),
    },
  };
}

const PUBLIC_EVENT = {
  event_id: "event-1",
  date: "2026-11-17",
  precise: "Y",
  event: "A test milestone",
  people: "Alice, Bob",
  type: "event",
  size: "m",
};

test("Stage 3 config is available only for exact localhost and a workers.dev origin", () => {
  expect(getSubmissionConfig(ENV, { origin: "http://localhost:3000" })).toEqual({
    available: true,
    apiOrigin: "https://stage-example.workers.dev",
    siteKey: "public-site-key",
  });

  expect(getSubmissionConfig(ENV, { origin: "https://ballerexpress.com" })).toEqual(
    expect.objectContaining({ available: false }),
  );
  expect(
    getSubmissionConfig(
      { ...ENV, REACT_APP_STAGE3_WORKER_ORIGIN: "https://example.com" },
      { origin: "http://localhost:3000" },
    ),
  ).toEqual(expect.objectContaining({ available: false }));
  expect(
    getSubmissionConfig(
      {
        ...ENV,
        REACT_APP_STAGE3_WORKER_ORIGIN:
          "https://stage-example.workers.dev/unexpected",
      },
      { origin: "http://localhost:3000" },
    ),
  ).toEqual(expect.objectContaining({ available: false }));
});

test("missing public config fails closed instead of falling back", async () => {
  const config = getSubmissionConfig({}, { origin: "http://localhost:3000" });
  const api = createSubmissionApi(config, jest.fn());

  await expect(api.submitMilestone({})).rejects.toMatchObject({
    code: "service_unavailable",
  });
});

test("people parsing trims comma-separated names and rejects duplicates", () => {
  expect(parsePeople("Alice, Bob ,  Dana")).toEqual(["Alice", "Bob", "Dana"]);
  expect(normalizePeople(["Alice"], "Bob, Dana")).toEqual([
    "Alice",
    "Bob",
    "Dana",
  ]);
  expect(() => normalizePeople(["Alice"], " alice ")).toThrow(
    /duplicate name/i,
  );
  expect(() => normalizePeople([], "")).toThrow(/at least one person/i);
});

test("legacy and ISO dates share display and sort helpers", () => {
  expect(toIsoDate("1/2/2020")).toBe("2020-01-02");
  expect(toIsoDate("2020-01-02")).toBe("2020-01-02");
  expect(dateSortKey("02/03/2021")).toBe("2021-02-03");
  expect(formatTimelineDate("2026-11-17", "Y")).toEqual({
    label: "November 17",
    year: "2026",
  });
  expect(formatTimelineDate("02/03/2021", "N")).toEqual({
    label: "February",
    year: "2021",
  });
});

test("request IDs use a secure RFC 4122 version 4 fallback", () => {
  const cryptoImpl = {
    getRandomValues(bytes) {
      bytes.set(Array.from({ length: 16 }, (_value, index) => index));
      return bytes;
    },
  };
  expect(createRequestId(cryptoImpl)).toBe(
    "00010203-0405-4607-8809-0a0b0c0d0e0f",
  );
  expect(() => createRequestId(null)).toThrow(SubmissionError);
});

test("submission API posts JSON to the exact milestone route", async () => {
  const fetchImpl = jest.fn().mockResolvedValue(
    response({
      status: 201,
      body: { ok: true, submissionId: "submission-1", event: PUBLIC_EVENT },
    }),
  );
  const api = createSubmissionApi(CONFIG, fetchImpl);
  const payload = { requestId: "request-1", turnstileToken: "token" };

  await expect(api.submitMilestone(payload)).resolves.toEqual({
    ok: true,
    submissionId: "submission-1",
    event: PUBLIC_EVENT,
  });
  expect(fetchImpl).toHaveBeenCalledWith(
    "https://stage-example.workers.dev/v1/milestones",
    expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal: expect.any(Object),
    }),
  );
});

test("submission API strips unexpected response fields", async () => {
  const api = createSubmissionApi(
    CONFIG,
    jest.fn().mockResolvedValue(
      response({
        status: 201,
        body: {
          ok: true,
          submissionId: "submission-1",
          privateMetadata: "must not escape",
          event: {
            ...PUBLIC_EVENT,
            contributorEmail: "private@example.invalid",
          },
        },
      }),
    ),
  );

  await expect(api.submitMilestone({})).resolves.toEqual({
    ok: true,
    submissionId: "submission-1",
    event: PUBLIC_EVENT,
  });
});

test("submission API preserves safe retry information and ignores raw messages", async () => {
  const fetchImpl = jest.fn().mockResolvedValue(
    response({
      ok: false,
      status: 429,
      retryAfter: "45",
      body: {
        ok: false,
        error: {
          code: "rate_limited",
          message: "untrusted upstream detail",
        },
      },
    }),
  );
  const api = createSubmissionApi(CONFIG, fetchImpl);

  await expect(api.submitEditProposal({})).rejects.toMatchObject({
    code: "rate_limited",
    message: "Too many attempts. Please wait before trying again.",
    retryAfterSeconds: 45,
    retryable: true,
  });
});

test("network and malformed success responses fail safely", async () => {
  const networkApi = createSubmissionApi(
    CONFIG,
    jest.fn().mockRejectedValue(new Error("private network detail")),
  );
  await expect(networkApi.submitMilestone({})).rejects.toMatchObject({
    code: "network_error",
    retryable: true,
  });

  const malformedApi = createSubmissionApi(
    CONFIG,
    jest.fn().mockResolvedValue(
      response({ body: { ok: true, submissionId: "submission-1" } }),
    ),
  );
  await expect(malformedApi.submitMilestone({})).rejects.toMatchObject({
    code: "service_unavailable",
  });
});

test("a stalled staging request aborts with a safe retryable timeout", async () => {
  jest.useFakeTimers();
  const fetchImpl = jest.fn((_url, options) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error("private abort detail");
        error.name = "AbortError";
        reject(error);
      });
    }),
  );
  const api = createSubmissionApi(CONFIG, fetchImpl);
  const request = api.submitMilestone({});

  jest.runOnlyPendingTimers();
  await expect(request).rejects.toMatchObject({
    code: "network_error",
    message: "The staging request took too long. Please try again.",
    retryable: true,
  });
  jest.useRealTimers();
});
