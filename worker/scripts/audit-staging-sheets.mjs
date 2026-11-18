import { lstat, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createGoogleAccessTokenProvider } from "../src/adapters/google-auth.js";
import { SHEET_LAYOUT } from "../src/adapters/google-sheets.js";

const WORKER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_VARS_PATH = resolve(WORKER_DIR, ".dev.vars");
const API_ROOT = "https://sheets.googleapis.com/v4/spreadsheets";
const MAX_ROWS_PER_TAB = 1_000;
const REQUEST_TIMEOUT_MS = 8_000;

const REQUIRED_LOCAL_VALUES = Object.freeze([
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_PRIVATE_KEY",
  "GOOGLE_SHEETS_SPREADSHEET_ID",
]);

const PUBLIC_HEADERS = Object.freeze([
  "event_id",
  "date",
  "precise",
  "event",
  "people",
  "type",
  "size",
]);

const RANGES = Object.freeze([
  Object.freeze({
    key: "source",
    range: `Timeline Source!A1:N${MAX_ROWS_PER_TAB}`,
  }),
  Object.freeze({
    key: "published",
    // Read through Q so a privacy leak outside the intended A:G projection is
    // detectable without printing any cell value.
    range: `Published Timeline (Generated)!A1:Q${MAX_ROWS_PER_TAB}`,
  }),
  Object.freeze({
    key: "proposals",
    range: `Edit Proposals!A1:Q${MAX_ROWS_PER_TAB}`,
  }),
]);

function parseValue(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith('"')) {
    try {
      const value = JSON.parse(trimmed);
      return typeof value === "string" ? value : "";
    } catch {
      throw new Error("The local staging variables contain an invalid quoted value.");
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseLocalStagingValues(contents) {
  const values = new Map();
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/,
    );
    if (!match || !REQUIRED_LOCAL_VALUES.includes(match[1])) continue;
    if (values.has(match[1])) {
      throw new Error(`${match[1]} must be defined exactly once.`);
    }
    const value = parseValue(match[2]);
    if (!value) throw new Error(`${match[1]} is present but empty.`);
    values.set(match[1], value);
  }

  const missing = REQUIRED_LOCAL_VALUES.filter((name) => !values.has(name));
  if (missing.length > 0) {
    throw new Error(`Missing required staging values: ${missing.join(", ")}`);
  }
  return Object.fromEntries(values);
}

function valuesAt(rows, row, column) {
  return rows?.[row]?.[column];
}

function exactHeader(rows, expected) {
  const header = rows?.[0];
  return (
    Array.isArray(header) &&
    header.length === expected.length &&
    header.every((value, index) => value === expected[index])
  );
}

function populatedRowCount(rows, identityColumn = 0) {
  if (!Array.isArray(rows)) return 0;
  return rows.slice(1).filter((row) => {
    const value = row?.[identityColumn];
    return value !== undefined && value !== null && value !== "";
  }).length;
}

function fixedStatusCounts(rows, column, allowed) {
  const counts = Object.fromEntries(allowed.map((status) => [status, 0]));
  counts.blank = 0;
  counts.other = 0;
  for (const row of (rows || []).slice(1)) {
    if (!row?.[0]) continue;
    const value = row?.[column];
    if (value === undefined || value === null || value === "") {
      counts.blank += 1;
    } else if (Object.hasOwn(counts, value)) {
      counts[value] += 1;
    } else {
      counts.other += 1;
    }
  }
  return Object.freeze(counts);
}

function actualFormulaCount(unformatted, formulaRendered, maxColumn) {
  let count = 0;
  const rowCount = Math.max(
    unformatted?.length || 0,
    formulaRendered?.length || 0,
  );
  for (let row = 1; row < rowCount; row += 1) {
    for (let column = 0; column < maxColumn; column += 1) {
      const formulaValue = valuesAt(formulaRendered, row, column);
      if (
        typeof formulaValue === "string" &&
        formulaValue.startsWith("=") &&
        valuesAt(unformatted, row, column) !== formulaValue
      ) {
        count += 1;
      }
    }
  }
  return count;
}

function isFormula(value, name) {
  return (
    typeof value === "string" &&
    value.startsWith("=") &&
    new RegExp(`(?:^|[^A-Z])${name}\\s*\\(`, "i").test(value)
  );
}

function containsOpenEndedRange(formula) {
  if (typeof formula !== "string") return false;
  return /\$?[A-Z]{1,3}\$?\d+:\$?[A-Z]{1,3}(?![\d:])/i.test(formula);
}

function rowsFromBatch(batch) {
  if (!batch || !Array.isArray(batch.valueRanges)) {
    throw new Error("The Sheets audit response was invalid.");
  }
  if (batch.valueRanges.length !== RANGES.length) {
    throw new Error("The Sheets audit returned an unexpected range count.");
  }
  return Object.fromEntries(
    RANGES.map(({ key }, index) => [
      key,
      Array.isArray(batch.valueRanges[index]?.values)
        ? batch.valueRanges[index].values
        : [],
    ]),
  );
}

export function summarizeStagingWorkbook({ unformatted, formulas }) {
  const raw = rowsFromBatch(unformatted);
  const rendered = rowsFromBatch(formulas);
  const sourceRows = populatedRowCount(raw.source);
  const publishedRows = populatedRowCount(raw.published);
  const proposalRows = populatedRowCount(raw.proposals);
  const visibleSourceRows = raw.source.slice(1).filter((row) => {
    const eventId = row?.[0];
    const hide = row?.[7];
    return eventId !== undefined && eventId !== null && eventId !== "" && hide !== "Y";
  }).length;
  const rankFormula = valuesAt(rendered.source, 1, 13);
  const projectionFormula = valuesAt(rendered.published, 1, 0);
  const sourceHeaders = SHEET_LAYOUT.milestone.headers;
  const proposalHeaders = SHEET_LAYOUT.editProposal.headers;

  return Object.freeze({
    ok: true,
    limits: Object.freeze({ maxRowsPerTab: MAX_ROWS_PER_TAB }),
    timelineSource: Object.freeze({
      rows: sourceRows,
      schemaMatches: exactHeader(raw.source, sourceHeaders),
      publishRankFormulaPresent: isFormula(rankFormula, "ARRAYFORMULA"),
      publishRankFormulaOpenEnded: containsOpenEndedRange(rankFormula),
      formulaCellsInWorkerOwnedColumns: actualFormulaCount(
        raw.source,
        rendered.source,
        13,
      ),
    }),
    publishedTimeline: Object.freeze({
      rows: publishedRows,
      schemaMatches: exactHeader(raw.published, PUBLIC_HEADERS),
      projectionFormulaPresent: isFormula(projectionFormula, "FILTER"),
      projectionFormulaOpenEnded: containsOpenEndedRange(projectionFormula),
      matchesVisibleSourceCount: publishedRows === visibleSourceRows,
      privateColumnsAbsent:
        exactHeader(raw.published, PUBLIC_HEADERS) &&
        raw.published.every((row) => row.length <= PUBLIC_HEADERS.length),
    }),
    editProposals: Object.freeze({
      rows: proposalRows,
      schemaMatches: exactHeader(raw.proposals, proposalHeaders),
      notificationStatuses: fixedStatusCounts(raw.proposals, 12, [
        "PENDING",
        "RETRY",
        "SENT",
        "FAILED",
        "SKIPPED",
      ]),
      formulaCellsInWorkerOwnedColumns: actualFormulaCount(
        raw.proposals,
        rendered.proposals,
        13,
      ),
    }),
  });
}

async function batchGet({ fetchImpl, spreadsheetId, token, renderOption }) {
  const url = new URL(
    `${API_ROOT}/${encodeURIComponent(spreadsheetId)}/values:batchGet`,
  );
  url.searchParams.set("majorDimension", "ROWS");
  url.searchParams.set("valueRenderOption", renderOption);
  for (const { range } of RANGES) url.searchParams.append("ranges", range);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("The staging Sheets audit was unavailable.");
    return await response.json();
  } catch (error) {
    if (error?.message === "The staging Sheets audit was unavailable.") {
      throw error;
    }
    throw new Error("The staging Sheets audit was unavailable.");
  } finally {
    clearTimeout(timer);
  }
}

export async function auditStagingSheets({
  env,
  fetchImpl = globalThis.fetch,
  tokenProvider = createGoogleAccessTokenProvider({ fetchImpl }),
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required.");
  }
  const spreadsheetId = env?.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (typeof spreadsheetId !== "string" || !spreadsheetId) {
    throw new Error("The staging spreadsheet ID is unavailable.");
  }
  const token = await tokenProvider.getToken(env);
  const [unformatted, formulas] = await Promise.all([
    batchGet({
      fetchImpl,
      spreadsheetId,
      token,
      renderOption: "UNFORMATTED_VALUE",
    }),
    batchGet({
      fetchImpl,
      spreadsheetId,
      token,
      renderOption: "FORMULA",
    }),
  ]);
  return summarizeStagingWorkbook({ unformatted, formulas });
}

async function readLocalEnvironment(path = DEFAULT_VARS_PATH) {
  const file = await lstat(path);
  if (!file.isFile() || file.isSymbolicLink()) {
    throw new Error("The local staging variables must be a regular file.");
  }
  if ((file.mode & 0o077) !== 0) {
    throw new Error("The local staging variables must have owner-only permissions.");
  }
  return parseLocalStagingValues(await readFile(path, "utf8"));
}

async function main() {
  const env = await readLocalEnvironment();
  const summary = await auditStagingSheets({ env });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
