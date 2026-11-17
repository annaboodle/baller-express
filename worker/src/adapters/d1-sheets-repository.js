import { canonicalJson, hmacSha256Hex } from "./crypto.js";
import { createD1Store } from "./d1-store.js";
import { createGoogleSheetsClient, SHEET_LAYOUT } from "./google-sheets.js";

const ROUTE_KIND = Object.freeze({
  "/v1/milestones": "milestone",
  "/v1/edit-proposals": "editProposal",
});

function positiveInteger(env, name) {
  const value = Number(env?.[name]);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function publicEvent(submission, eventId) {
  return {
    event_id: eventId,
    date: submission.date,
    precise: submission.approximate ? "N" : "Y",
    event: submission.description,
    people: submission.people.join(", "),
    type: submission.type,
    size: "m",
  };
}

function parseResponse(row) {
  if (row.public_response_json === null || row.public_response_json === "") {
    return undefined;
  }
  const parsed = JSON.parse(row.public_response_json);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The stored public response is invalid.");
  }
  return parsed;
}

function replay(row) {
  const result = { kind: "replay", submissionId: row.submission_id };
  const event = parseResponse(row);
  if (event) result.event = event;
  return result;
}

async function fingerprint({ env, endpoint, submission, hash }) {
  const {
    requestId: _requestId,
    turnstileToken: _turnstileToken,
    contributorName: _contributorName,
    contributorEmail: _contributorEmail,
    ...payload
  } = submission;
  return hash(
    env?.REQUEST_HASH_SECRET,
    `${endpoint}\0${canonicalJson(payload)}`,
  );
}

function ownerFieldsFor(kind, ownerFields) {
  if (kind === "milestone") {
    if (
      ownerFields?.hide !== "N" ||
      ownerFields?.source !== "public_submission"
    ) {
      throw new Error("Milestone owner fields are invalid.");
    }
    return ownerFields;
  }
  if (ownerFields?.source !== "public_edit_proposal") {
    throw new Error("Edit-proposal owner fields are invalid.");
  }
  return ownerFields;
}

function milestoneRow({
  event,
  ownerFields,
  submission,
  submissionId,
  submittedAt,
}) {
  return [
    event.event_id,
    event.date,
    event.precise,
    event.event,
    event.people,
    event.type,
    event.size,
    ownerFields.hide,
    ownerFields.source,
    submittedAt,
    submissionId,
    submission.contributorName || "",
    submission.contributorEmail || "",
  ];
}

function editProposalRow({
  ownerFields,
  proposalId,
  submission,
  submissionId,
  submittedAt,
}) {
  return [
    proposalId,
    submissionId,
    ownerFields.source,
    submittedAt,
    submission.original.eventId,
    submission.original.date,
    submission.original.description,
    submission.original.people.join(", "),
    submission.fields.join(", "),
    submission.requestedChange,
    submission.contributorName || "",
    submission.contributorEmail || "",
    "PENDING",
  ];
}

export function createD1SheetsRepository({
  store = createD1Store(),
  fetchImpl = globalThis.fetch,
  sheets = createGoogleSheetsClient({ fetchImpl }),
  now = () => Date.now(),
  randomUuid = () => globalThis.crypto.randomUUID(),
  hash = hmacSha256Hex,
} = {}) {
  async function findExisting({ endpoint, env, submission, payloadHash }) {
    const row = await store.getRequest({
      env,
      requestId: submission.requestId,
    });
    if (!row) return null;
    if (row.endpoint !== endpoint || row.payload_hash !== payloadHash) {
      return { kind: "conflict" };
    }
    if (row.state === "created") return replay(row);
    if (row.state !== "pending") {
      throw new Error("The request state is invalid.");
    }

    const kind = ROUTE_KIND[endpoint];
    const layout = SHEET_LAYOUT[kind];
    const exists = await sheets.hasSubmission({
      env,
      range: layout.submissionIdRange,
      submissionId: row.submission_id,
    });
    if (exists) {
      const completed = await store.completeRequest({
        env,
        requestId: submission.requestId,
        completedAt: Math.floor(now() / 1000),
      });
      if (!completed) throw new Error("The replay could not be finalized.");
      return replay(row);
    }

    const staleSeconds = positiveInteger(env, "PENDING_STALE_SECONDS");
    if (Math.floor(now() / 1000) - Number(row.created_at) < staleSeconds) {
      throw new Error("The request is still pending.");
    }
    await store.deletePendingRequest({
      env,
      requestId: submission.requestId,
    });
    await store.releaseDedupe({
      env,
      dedupeKey: row.dedupe_key,
      requestId: submission.requestId,
    });
    return null;
  }

  async function create({ endpoint, env, ownerFields, submission }) {
    const kind = ROUTE_KIND[endpoint];
    if (!kind) throw new Error("The repository endpoint is invalid.");
    ownerFieldsFor(kind, ownerFields);

    const payloadHash = await fingerprint({ env, endpoint, submission, hash });
    const existing = await findExisting({
      endpoint,
      env,
      submission,
      payloadHash,
    });
    if (existing) return existing;

    const nowMs = now();
    const nowSeconds = Math.floor(nowMs / 1000);
    const submittedAt = nowMs / 86_400_000 + 25_569;
    const submissionId = `submission-${randomUuid()}`;
    const layout = SHEET_LAYOUT[kind];
    let event;
    let row;
    if (kind === "milestone") {
      event = publicEvent(submission, `event-${randomUuid()}`);
      row = milestoneRow({
        event,
        ownerFields,
        submission,
        submissionId,
        submittedAt,
      });
    } else {
      row = editProposalRow({
        ownerFields,
        proposalId: `proposal-${randomUuid()}`,
        submission,
        submissionId,
        submittedAt,
      });
    }

    const dedupeKey = `${endpoint}:${payloadHash}`;
    const reserved = await store.reserveRequest({
      env,
      record: {
        requestId: submission.requestId,
        endpoint,
        payloadHash,
        submissionId,
        sheetName: layout.name,
        dedupeKey,
        publicResponseJson: event ? JSON.stringify(event) : null,
        createdAt: nowSeconds,
      },
    });
    if (!reserved) {
      const raced = await findExisting({
        endpoint,
        env,
        submission,
        payloadHash,
      });
      if (raced) return raced;
      throw new Error("The request reservation failed.");
    }

    const dedupeWindow = positiveInteger(env, "DEDUPE_WINDOW_SECONDS");
    const acquiredBy = await store.acquireDedupe({
      env,
      dedupeKey,
      requestId: submission.requestId,
      expiresAt: nowSeconds + dedupeWindow,
      nowSeconds,
    });
    if (acquiredBy !== submission.requestId) {
      await store.deletePendingRequest({
        env,
        requestId: submission.requestId,
      });
      return { kind: "duplicate" };
    }

    try {
      await sheets.appendRow({ env, range: layout.appendRange, values: row });
      const completed = await store.completeRequest({
        env,
        requestId: submission.requestId,
        completedAt: Math.floor(now() / 1000),
      });
      if (!completed) throw new Error("The submission could not be finalized.");
    } catch (error) {
      // A network failure may occur after Sheets accepted the row. Keep the
      // pending reservation so findReplay can reconcile by submission ID.
      // If no row exists, the stale-pending path releases it later.
      throw error;
    }

    const result = { kind: "created", submissionId };
    if (event) result.event = event;
    return result;
  }

  return Object.freeze({
    async findReplay({ endpoint, env, submission }) {
      const payloadHash = await fingerprint({ env, endpoint, submission, hash });
      return findExisting({ endpoint, env, submission, payloadHash });
    },

    async createMilestone(context) {
      return create(context);
    },

    async createEditProposal(context) {
      return create(context);
    },
  });
}
