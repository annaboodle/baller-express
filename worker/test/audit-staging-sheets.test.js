import assert from "node:assert/strict";
import test from "node:test";

import {
  auditStagingSheets,
  parseLocalStagingValues,
  summarizeStagingWorkbook,
} from "../scripts/audit-staging-sheets.mjs";
import { SHEET_LAYOUT } from "../src/adapters/google-sheets.js";

function batch(source, published, proposals) {
  return {
    valueRanges: [
      { values: source },
      { values: published },
      { values: proposals },
    ],
  };
}

const sourceHeaders = [...SHEET_LAYOUT.milestone.headers];
const proposalHeaders = [...SHEET_LAYOUT.editProposal.headers];
const publicHeaders = [
  "event_id",
  "date",
  "precise",
  "event",
  "people",
  "type",
  "size",
];

test("parses only the required Google staging values", () => {
  const parsed = parseLocalStagingValues(
    [
      "TURNSTILE_SECRET_KEY=ignored",
      "GOOGLE_SERVICE_ACCOUNT_EMAIL=staging@example.invalid",
      'GOOGLE_PRIVATE_KEY="line-one\\nline-two"',
      "GOOGLE_SHEETS_SPREADSHEET_ID=staging-sheet",
    ].join("\n"),
  );
  assert.deepEqual(parsed, {
    GOOGLE_SERVICE_ACCOUNT_EMAIL: "staging@example.invalid",
    GOOGLE_PRIVATE_KEY: "line-one\nline-two",
    GOOGLE_SHEETS_SPREADSHEET_ID: "staging-sheet",
  });
});

test("rejects duplicate, empty, or missing staging values", () => {
  const complete = [
    "GOOGLE_SERVICE_ACCOUNT_EMAIL=staging@example.invalid",
    "GOOGLE_PRIVATE_KEY=private-key",
    "GOOGLE_SHEETS_SPREADSHEET_ID=staging-sheet",
  ].join("\n");
  assert.throws(
    () =>
      parseLocalStagingValues(
        `${complete}\nGOOGLE_SHEETS_SPREADSHEET_ID=duplicate`,
      ),
    /must be defined exactly once/,
  );
  assert.throws(
    () =>
      parseLocalStagingValues(
        complete.replace("GOOGLE_PRIVATE_KEY=private-key", "GOOGLE_PRIVATE_KEY="),
      ),
    /present but empty/,
  );
  assert.throws(
    () =>
      parseLocalStagingValues(
        complete.replace(/^GOOGLE_SERVICE_ACCOUNT_EMAIL=.*\n/m, ""),
      ),
    /Missing required staging values/,
  );
});

test("summarizes counts, schemas, formula health, and privacy without row data", () => {
  const source = [
    sourceHeaders,
    [
      "sensitive-event-id",
      "2026-01-01",
      "Y",
      "private-description",
      "Private Person",
      "event",
      "m",
      "N",
      "public_submission",
      1,
      "sensitive-submission-id",
      "Sensitive Contributor",
      "sensitive@example.invalid",
      1,
    ],
    ["hidden-event", "2026-01-02", "Y", "hidden", "Hidden", "event", "m", "Y"],
  ];
  const published = [
    publicHeaders,
    [
      "sensitive-event-id",
      "2026-01-01",
      "Y",
      "private-description",
      "Private Person",
      "event",
      "m",
    ],
  ];
  const proposals = [
    proposalHeaders,
    [
      "private-proposal-id",
      "sensitive-submission-id",
      "public_edit_proposal",
      1,
      "sensitive-event-id",
      "2026-01-01",
      "private-description",
      "Private Person",
      "date",
      "private-request",
      "Sensitive Contributor",
      "sensitive@example.invalid",
      "PENDING",
    ],
  ];
  const formulaSource = source.map((row) => [...row]);
  formulaSource[1][13] = "=ARRAYFORMULA(IF(A2:A=\"\",,ROW(A2:A)))";
  const formulaPublished = published.map((row) => [...row]);
  formulaPublished[1][0] =
    "=IFERROR(FILTER('Timeline Source'!A2:G,'Timeline Source'!H2:H<>\"Y\"),\"\")";
  const result = summarizeStagingWorkbook({
    unformatted: batch(source, published, proposals),
    formulas: batch(formulaSource, formulaPublished, proposals),
  });

  assert.deepEqual(result, {
    ok: true,
    limits: { maxRowsPerTab: 1_000 },
    timelineSource: {
      rows: 2,
      schemaMatches: true,
      publishRankFormulaPresent: true,
      publishRankFormulaOpenEnded: true,
      formulaCellsInWorkerOwnedColumns: 0,
    },
    publishedTimeline: {
      rows: 1,
      schemaMatches: true,
      projectionFormulaPresent: true,
      projectionFormulaOpenEnded: true,
      matchesVisibleSourceCount: true,
      privateColumnsAbsent: true,
    },
    editProposals: {
      rows: 1,
      schemaMatches: true,
      notificationStatuses: {
        PENDING: 1,
        RETRY: 0,
        SENT: 0,
        FAILED: 0,
        SKIPPED: 0,
        blank: 0,
        other: 0,
      },
      formulaCellsInWorkerOwnedColumns: 0,
    },
  });
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    "sensitive-event-id",
    "private-description",
    "Sensitive Person",
    "Sensitive Contributor",
    "sensitive@example.invalid",
    "private-request",
  ]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden, "i"));
  }
});

test("buckets blank and unknown notification states without exposing values", () => {
  const proposals = [proposalHeaders];
  for (const [id, status] of [
    ["proposal-sent", "SENT"],
    ["proposal-skipped", "SKIPPED"],
    ["proposal-blank", ""],
    ["proposal-unknown", "private-unexpected-status"],
    ["", "FAILED"],
  ]) {
    const row = new Array(13).fill("");
    row[0] = id;
    row[12] = status;
    proposals.push(row);
  }
  const summary = summarizeStagingWorkbook({
    unformatted: batch([sourceHeaders], [publicHeaders], proposals),
    formulas: batch([sourceHeaders], [publicHeaders], proposals),
  });

  assert.equal(summary.editProposals.rows, 4);
  assert.deepEqual(summary.editProposals.notificationStatuses, {
    PENDING: 0,
    RETRY: 0,
    SENT: 1,
    FAILED: 0,
    SKIPPED: 1,
    blank: 1,
    other: 1,
  });
  assert.doesNotMatch(JSON.stringify(summary), /private-unexpected-status/);
});

test("uses two bounded batch reads and returns only the aggregate summary", async () => {
  const source = [sourceHeaders];
  const published = [publicHeaders];
  const proposals = [proposalHeaders];
  const formulaSource = [sourceHeaders, new Array(14).fill("")];
  formulaSource[1][13] = "=ARRAYFORMULA(A2:A)";
  const formulaPublished = [publicHeaders, ["=FILTER(A2:G,A2:A<>\"\")"]];
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url: String(url), authorization: init.headers.authorization });
    const isFormula = String(url).includes("valueRenderOption=FORMULA");
    return new Response(
      JSON.stringify(
        isFormula
          ? batch(formulaSource, formulaPublished, proposals)
          : batch(source, published, proposals),
      ),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const result = await auditStagingSheets({
    env: {
      GOOGLE_SHEETS_SPREADSHEET_ID: "private-spreadsheet-id",
      GOOGLE_SERVICE_ACCOUNT_EMAIL: "not-used@example.invalid",
      GOOGLE_PRIVATE_KEY: "not-used",
    },
    fetchImpl,
    tokenProvider: { async getToken() { return "private-access-token"; } },
  });

  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.authorization, "Bearer private-access-token");
    assert.match(request.url, /A1%3AN1000/);
    assert.match(request.url, /A1%3AQ1000/);
    assert.match(request.url, /A1%3AQ1000/);
  }
  assert.equal(result.timelineSource.rows, 0);
  assert.doesNotMatch(JSON.stringify(result), /private-spreadsheet-id|private-access-token/);
});

test("detects any populated column outside the public A:G projection", () => {
  const source = [sourceHeaders];
  const published = [publicHeaders, ["event", "2026-01-01", "Y", "desc", "A", "event", "m", "private"]];
  const proposals = [proposalHeaders];
  const result = summarizeStagingWorkbook({
    unformatted: batch(source, published, proposals),
    formulas: batch(source, published, proposals),
  });
  assert.equal(result.publishedTimeline.schemaMatches, true);
  assert.equal(result.publishedTimeline.privateColumnsAbsent, false);
});
