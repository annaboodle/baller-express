import { createGoogleAccessTokenProvider } from "./google-auth.js";
import {
  UPSTREAM_FAILURE_CATEGORIES,
  UpstreamDependencyError,
} from "./upstream-error.js";

const API_ROOT = "https://sheets.googleapis.com/v4/spreadsheets";
const DEFAULT_TIMEOUT_MS = 8_000;

function unavailable(message) {
  return new UpstreamDependencyError(
    UPSTREAM_FAILURE_CATEGORIES.sheets,
    message,
  );
}

export const SHEET_LAYOUT = Object.freeze({
  milestone: Object.freeze({
    name: "Timeline Source",
    appendRange: "Timeline Source!A:M",
    eventIdRange: "Timeline Source!A:A",
    submissionIdRange: "Timeline Source!K:K",
    headerRange: "Timeline Source!A1:N1",
    headers: Object.freeze([
      "event_id",
      "date",
      "precise",
      "event",
      "people",
      "type",
      "size",
      "hide",
      "source",
      "submitted_at",
      "submission_id",
      "contributor_name",
      "contributor_email",
      "publish_rank",
    ]),
    writeColumnCount: 13,
  }),
  editProposal: Object.freeze({
    name: "Edit Proposals",
    appendRange: "Edit Proposals!A:M",
    submissionIdRange: "Edit Proposals!B:B",
    headerRange: "Edit Proposals!A1:Q1",
    headers: Object.freeze([
      "proposal_id",
      "submission_id",
      "source",
      "submitted_at",
      "original_event_id",
      "original_date",
      "original_description",
      "original_people",
      "fields",
      "requested_change",
      "contributor_name",
      "contributor_email",
      "notification_status",
      "notified_at",
      "review_status",
      "reviewed_at",
      "reviewer_notes",
    ]),
    writeColumnCount: 13,
  }),
});

function spreadsheetId(env) {
  const value = env?.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (typeof value !== "string" || value.length === 0) {
    throw unavailable("The staging spreadsheet ID is unavailable.");
  }
  return value;
}

function valuesUrl(env, range, suffix = "") {
  return `${API_ROOT}/${encodeURIComponent(spreadsheetId(env))}/values/${encodeURIComponent(range)}${suffix}`;
}

function positiveTimeout(value) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("The Google request timeout must be a positive integer.");
  }
  return value;
}

function layoutForRange(range, field) {
  const layout = Object.values(SHEET_LAYOUT).find(
    (candidate) => candidate[field] === range,
  );
  if (!layout) throw new Error("The staging spreadsheet range is not allowed.");
  return layout;
}

async function requestJson({
  fetchImpl,
  url,
  init = {},
  timeoutMs,
  unavailableMessage,
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!response.ok) throw unavailable(unavailableMessage);
    return await response.json();
  } catch (error) {
    if (error instanceof UpstreamDependencyError) {
      throw error;
    }
    throw unavailable(unavailableMessage);
  } finally {
    clearTimeout(timer);
  }
}

function assertExactHeaders(result, layout) {
  const actual = result?.values?.[0];
  if (
    !Array.isArray(actual) ||
    actual.length !== layout.headers.length ||
    actual.some((value, index) => value !== layout.headers[index])
  ) {
    throw unavailable(
      `The ${layout.name} schema does not match the Worker contract.`,
    );
  }
}

export function createGoogleSheetsClient({
  fetchImpl = globalThis.fetch,
  tokenProvider = createGoogleAccessTokenProvider({ fetchImpl }),
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required.");
  }
  const requestTimeoutMs = positiveTimeout(timeoutMs);

  async function readValues({ env, range, token, unavailableMessage }) {
    return requestJson({
      fetchImpl,
      url: valuesUrl(env, range),
      init: { headers: { authorization: `Bearer ${token}` } },
      timeoutMs: requestTimeoutMs,
      unavailableMessage,
    });
  }

  async function assertSchema({ env, layout, token }) {
    const result = await readValues({
      env,
      range: layout.headerRange,
      token,
      unavailableMessage: "The staging spreadsheet schema check failed.",
    });
    assertExactHeaders(result, layout);
  }

  return Object.freeze({
    async appendRow({ env, range, values }) {
      const layout = layoutForRange(range, "appendRange");
      if (!Array.isArray(values) || values.length !== layout.writeColumnCount) {
        throw new Error(
          `A ${layout.writeColumnCount}-column Sheets row is required.`,
        );
      }
      const token = await tokenProvider.getToken(env);
      await assertSchema({ env, layout, token });
      const result = await requestJson({
        fetchImpl,
        url: valuesUrl(
          env,
          range,
          ":append?valueInputOption=RAW&insertDataOption=OVERWRITE",
        ),
        init: {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ majorDimension: "ROWS", values: [values] }),
        },
        timeoutMs: requestTimeoutMs,
        unavailableMessage: "The staging spreadsheet write failed.",
      });
      // The Values API can omit trailing blank cells from updatedColumns, so
      // enforce the row width before the request and verify exactly one row
      // was accepted here.
      if (result?.updates?.updatedRows !== 1) {
        throw unavailable("The staging spreadsheet write was incomplete.");
      }
      return result;
    },

    async hasSubmission({ env, range, submissionId }) {
      const layout = layoutForRange(range, "submissionIdRange");
      if (typeof submissionId !== "string" || submissionId.length === 0) {
        throw new Error("A submission ID is required.");
      }
      const token = await tokenProvider.getToken(env);
      await assertSchema({ env, layout, token });
      const result = await readValues({
        env,
        range,
        token,
        unavailableMessage: "The staging spreadsheet lookup failed.",
      });
      return (result?.values || []).some(
        (row) => Array.isArray(row) && row[0] === submissionId,
      );
    },

    async hasEvent({ env, range, eventId }) {
      const layout = layoutForRange(range, "eventIdRange");
      if (typeof eventId !== "string" || eventId.length === 0) {
        throw new Error("An event ID is required.");
      }
      const token = await tokenProvider.getToken(env);
      await assertSchema({ env, layout, token });
      const result = await readValues({
        env,
        range,
        token,
        unavailableMessage: "The staging event lookup failed.",
      });
      return (result?.values || []).some(
        (row) => Array.isArray(row) && row[0] === eventId,
      );
    },
  });
}
