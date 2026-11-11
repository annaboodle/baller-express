export const ORIGIN = "https://ballerexpress.com";

export const enabledEnv = Object.freeze({
  ALLOWED_ORIGIN: ORIGIN,
  SUBMISSIONS_ENABLED: "true",
});

export function validMilestone(overrides = {}) {
  return {
    requestId: "123e4567-e89b-42d3-a456-426614174000",
    turnstileToken: "test-turnstile-token",
    type: "trip",
    date: "2026-11-11",
    approximate: false,
    description: "A test trip",
    people: ["Alice", "Bob"],
    contributorName: "Test Contributor",
    contributorEmail: "test@example.com",
    ...overrides,
  };
}

export function validEditProposal(overrides = {}) {
  return {
    requestId: "223e4567-e89b-42d3-a456-426614174000",
    turnstileToken: "test-turnstile-token",
    original: {
      date: "2020-01-02",
      description: "Alice and Bob met",
      people: ["Alice", "Bob"],
    },
    fields: ["description"],
    requestedChange: "Clarify where they met.",
    ...overrides,
  };
}

export function validPublicEvent(overrides = {}) {
  return {
    event_id: "event-1",
    date: "11/11/2026",
    precise: "Y",
    event: "A test trip",
    people: "Alice, Bob",
    type: "trip",
    size: "m",
    ...overrides,
  };
}

export function jsonRequest(path, body, init = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (!headers.has("origin")) {
    headers.set("origin", ORIGIN);
  }
  return new Request(`https://api.example.test${path}`, {
    method: "POST",
    ...init,
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
