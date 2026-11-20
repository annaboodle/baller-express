import { publicFields as PUBLIC_EVENT_FIELDS, productionSubmissionConfig } from "./productionConfig.mjs";

const LOCAL_REVIEW_ORIGIN = "http://localhost:3000";
const REQUEST_TIMEOUT_MS = 15_000;

const SAFE_ERROR_MESSAGES = Object.freeze({
  duplicate_submission: "This submission was already received.",
  event_not_found:
    "That milestone is not available in staging yet. Please refresh and try again.",
  invalid_submission: "Check the form fields and try again.",
  origin_not_allowed: "Submissions are only available from the local review site.",
  rate_limited: "Too many attempts. Please wait before trying again.",
  request_id_conflict:
    "This submission changed while it was being sent. Please review it and try again.",
  service_unavailable: "Submissions are temporarily unavailable. Please try again.",
  verification_failed: "Human verification failed. Please try again.",
});

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function currentLocation() {
  return typeof window === "undefined" ? undefined : window.location;
}

function unavailableConfig(message) {
  return Object.freeze({ available: false, message });
}

export function getSubmissionConfig(
  env = process.env,
  location = currentLocation(),
) {
  if (location?.origin === "https://ballerexpress.com") {
    return productionSubmissionConfig(env) || unavailableConfig(SAFE_ERROR_MESSAGES.service_unavailable);
  }
  if (!location || location.origin !== LOCAL_REVIEW_ORIGIN) {
    return unavailableConfig(
      "Stage 3 submissions are available only at http://localhost:3000.",
    );
  }

  const rawOrigin = env.REACT_APP_STAGE3_WORKER_ORIGIN;
  const siteKey = env.REACT_APP_STAGE3_TURNSTILE_SITE_KEY;
  if (!rawOrigin || !siteKey) {
    return unavailableConfig(
      "Stage 3 submission settings are missing. Add the local staging environment values and restart the app.",
    );
  }

  let parsed;
  try {
    parsed = new URL(rawOrigin);
  } catch {
    return unavailableConfig("The local staging Worker setting is invalid.");
  }

  const isExactWorkersOrigin =
    parsed.protocol === "https:" &&
    parsed.hostname.endsWith(".workers.dev") &&
    parsed.hostname !== "workers.dev" &&
    parsed.pathname === "/" &&
    parsed.search === "" &&
    parsed.hash === "" &&
    parsed.username === "" &&
    parsed.password === "";
  if (!isExactWorkersOrigin) {
    return unavailableConfig("The local staging Worker setting is invalid.");
  }

  if (typeof siteKey !== "string" || siteKey.trim().length < 5) {
    return unavailableConfig("The local Turnstile site-key setting is invalid.");
  }

  return Object.freeze({
    available: true,
    apiOrigin: parsed.origin,
    siteKey: siteKey.trim(),
  });
}

export class SubmissionError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "SubmissionError";
    this.code = code;
    this.status = options.status;
    this.fields = Array.isArray(options.fields) ? options.fields : [];
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.retryable = Boolean(options.retryable);
  }
}

function retryableCode(code, status) {
  return (
    code === "service_unavailable" ||
    code === "verification_failed" ||
    code === "rate_limited" ||
    status >= 500
  );
}

function safeFields(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof item.field === "string" &&
        typeof item.message === "string",
    )
    .slice(0, 20)
    .map(({ field, message }) => ({ field, message }));
}

function assertSuccessBody(body, kind) {
  const baseIsValid =
    body &&
    body.ok === true &&
    typeof body.submissionId === "string" &&
    body.submissionId.length > 0;
  if (!baseIsValid) {
    throw new SubmissionError(
      "service_unavailable",
      SAFE_ERROR_MESSAGES.service_unavailable,
      { retryable: true },
    );
  }

  if (kind === "milestone") {
    const validEvent =
      body.event &&
      typeof body.event === "object" &&
      PUBLIC_EVENT_FIELDS.every(
        (field) =>
          typeof body.event[field] === "string" &&
          body.event[field].length > 0,
      );
    if (!validEvent) {
      throw new SubmissionError(
        "service_unavailable",
        SAFE_ERROR_MESSAGES.service_unavailable,
        { retryable: true },
      );
    }
    return {
      ok: true,
      submissionId: body.submissionId,
      event: Object.fromEntries(
        PUBLIC_EVENT_FIELDS.map((field) => [field, body.event[field]]),
      ),
    };
  }
  return { ok: true, submissionId: body.submissionId };
}

export function createSubmissionApi(
  config,
  fetchImpl = typeof window === "undefined" ? undefined : window.fetch,
) {
  if (!config || !config.available || typeof fetchImpl !== "function") {
    return Object.freeze({
      async submitMilestone() {
        throw new SubmissionError(
          "service_unavailable",
          config?.message || SAFE_ERROR_MESSAGES.service_unavailable,
        );
      },
      async submitEditProposal() {
        throw new SubmissionError(
          "service_unavailable",
          config?.message || SAFE_ERROR_MESSAGES.service_unavailable,
        );
      },
    });
  }

  async function post(path, payload, kind) {
    let response;
    const abortController =
      typeof AbortController === "function" ? new AbortController() : null;
    const timeoutId = abortController
      ? setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS)
      : null;
    try {
      response = await fetchImpl(`${config.apiOrigin}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        ...(abortController ? { signal: abortController.signal } : {}),
      });
    } catch (error) {
      throw new SubmissionError(
        "network_error",
        config.production ? SAFE_ERROR_MESSAGES.service_unavailable : error?.name === "AbortError"
          ? "The staging request took too long. Please try again."
          : "The submission could not reach staging. Check your connection and try again.",
        { retryable: true },
      );
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
    }

    let body;
    try {
      body = await response.json();
    } catch {
      throw new SubmissionError(
        "service_unavailable",
        SAFE_ERROR_MESSAGES.service_unavailable,
        { status: response.status, retryable: true },
      );
    }

    if (!response.ok || !body || body.ok !== true) {
      const code =
        typeof body?.error?.code === "string"
          ? body.error.code
          : "service_unavailable";
      const retryAfter = Number(response.headers?.get?.("retry-after"));
      throw new SubmissionError(
        code,
        config.production && ["origin_not_allowed", "event_not_found"].includes(code)
          ? SAFE_ERROR_MESSAGES.service_unavailable
          : SAFE_ERROR_MESSAGES[code] || "The submission could not be accepted.",
        {
          status: response.status,
          fields: safeFields(body?.error?.fields),
          retryAfterSeconds:
            Number.isFinite(retryAfter) && retryAfter > 0
              ? retryAfter
              : undefined,
          retryable: retryableCode(code, response.status),
        },
      );
    }

    return assertSuccessBody(body, kind);
  }

  return Object.freeze({
    submitMilestone(payload) {
      return post("/v1/milestones", payload, "milestone");
    },
    submitEditProposal(payload) {
      return post("/v1/edit-proposals", payload, "editProposal");
    },
  });
}

export function createRequestId(
  cryptoImpl = typeof window === "undefined" ? undefined : window.crypto,
) {
  if (cryptoImpl && typeof cryptoImpl.randomUUID === "function") {
    return cryptoImpl.randomUUID();
  }
  if (!cryptoImpl || typeof cryptoImpl.getRandomValues !== "function") {
    throw new SubmissionError(
      "service_unavailable",
      "This browser cannot create a secure submission ID.",
    );
  }
  const bytes = new Uint8Array(16);
  cryptoImpl.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16,
  )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function parsePeople(value) {
  if (Array.isArray(value)) return value.map(String).map((name) => name.trim());
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

export function normalizePeople(selectedPeople, otherPeople = "") {
  const combined = [
    ...parsePeople(selectedPeople),
    ...parsePeople(otherPeople),
  ].map((name) => name.replace(/\s+/g, " ").trim());
  const people = [];
  const seen = new Set();
  for (const person of combined) {
    if (!person) continue;
    const key = person.toLocaleLowerCase("en-US");
    if (seen.has(key)) {
      throw new SubmissionError(
        "invalid_people",
        `Remove the duplicate name “${person}” and try again.`,
        { fields: [{ field: "people", message: "People must be unique." }] },
      );
    }
    seen.add(key);
    people.push(person);
  }
  if (people.length === 0) {
    throw new SubmissionError(
      "invalid_people",
      "Choose or enter at least one person.",
      { fields: [{ field: "people", message: "At least one person is required." }] },
    );
  }
  return people;
}

function dateParts(dateString) {
  if (typeof dateString !== "string") return null;
  let year;
  let month;
  let day;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    [year, month, day] = dateString.split("-").map(Number);
  } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateString)) {
    [month, day, year] = dateString.split("/").map(Number);
  } else {
    return null;
  }
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

export function toIsoDate(dateString) {
  const parts = dateParts(dateString);
  if (!parts) return "";
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(
    2,
    "0",
  )}-${String(parts.day).padStart(2, "0")}`;
}

export function formatTimelineDate(dateString, precise) {
  const parts = dateParts(dateString);
  if (!parts) return { label: "Unknown date", year: "" };
  const label = `${MONTH_NAMES[parts.month - 1]} ${
    precise === "N" ? "" : parts.day
  }`.trim();
  return { label, year: String(parts.year) };
}

export function dateSortKey(dateString) {
  return toIsoDate(dateString);
}
