import assert from "node:assert/strict";
import test from "node:test";

import {
  validateEditProposal,
  validateMilestone,
} from "../src/validation.js";
import { validEditProposal, validMilestone } from "./fixtures.js";

test("accepts and normalizes a valid milestone", () => {
  const result = validateMilestone(
    validMilestone({
      description: "  A   test trip  ",
      people: [" Alice ", "Bob Jones"],
    }),
  );

  assert.deepEqual(result.issues, []);
  assert.equal(result.value.description, "A test trip");
  assert.deepEqual(result.value.people, ["Alice", "Bob Jones"]);
});

test("rejects dates before 1971 and accepts future dates", () => {
  const oldResult = validateMilestone(validMilestone({ date: "1970-05-31" }));
  const futureResult = validateMilestone(
    validMilestone({ date: "2099-12-31" }),
  );

  assert.ok(oldResult.issues.some((entry) => entry.field === "date"));
  assert.deepEqual(futureResult.issues, []);
});

test("rejects impossible calendar dates", () => {
  const result = validateMilestone(validMilestone({ date: "2026-02-30" }));
  assert.ok(result.issues.some((entry) => entry.code === "invalid_date"));
});

test("rejects duplicate people after normalization", () => {
  const result = validateMilestone(
    validMilestone({ people: ["Alice", " alice "] }),
  );
  assert.ok(result.issues.some((entry) => entry.code === "duplicate_person"));
});

test("rejects commas inside individual people names", () => {
  const milestone = validateMilestone(
    validMilestone({ people: ["Alice, Jr.", "Bob"] }),
  );
  const edit = validateEditProposal(
    validEditProposal({
      original: {
        ...validEditProposal().original,
        people: ["Alice", "Bob, Sr."],
      },
    }),
  );

  assert.ok(
    milestone.issues.some((entry) => entry.code === "invalid_person_delimiter"),
  );
  assert.ok(
    edit.issues.some((entry) => entry.code === "invalid_person_delimiter"),
  );
});

test("rejects owner-controlled and unknown fields", () => {
  const result = validateMilestone(validMilestone({ hide: "N" }));
  assert.ok(
    result.issues.some(
      (entry) => entry.field === "hide" && entry.code === "unknown_field",
    ),
  );
});

test("preserves formula-like user text for literal storage", () => {
  const result = validateMilestone(
    validMilestone({ description: "=IMPORTDATA(\"https://example.test\")" }),
  );
  assert.deepEqual(result.issues, []);
  assert.equal(
    result.value.description,
    "=IMPORTDATA(\"https://example.test\")",
  );
});

test("requires complete original context for edit proposals", () => {
  const result = validateEditProposal(
    validEditProposal({
      original: { date: "", description: "", people: [] },
    }),
  );
  assert.ok(result.issues.some((entry) => entry.field === "original.date"));
  assert.ok(
    result.issues.some((entry) => entry.field === "original.description"),
  );
  assert.ok(result.issues.some((entry) => entry.field === "original.people"));
});

test("requires an immutable existing event reference for edit proposals", () => {
  const missing = validateEditProposal(
    validEditProposal({
      original: {
        date: "2020-01-02",
        description: "Alice and Bob met",
        people: ["Alice", "Bob"],
      },
    }),
  );
  const malformed = validateEditProposal(
    validEditProposal({
      original: { ...validEditProposal().original, eventId: "not an id" },
    }),
  );

  assert.ok(missing.issues.some((entry) => entry.field === "original.eventId"));
  assert.ok(
    malformed.issues.some((entry) => entry.code === "invalid_event_id"),
  );
});

test("requires unique allowed edit fields and a requested change", () => {
  const result = validateEditProposal(
    validEditProposal({ fields: ["description", "description"], requestedChange: "" }),
  );
  assert.ok(result.issues.some((entry) => entry.field === "fields"));
  assert.ok(result.issues.some((entry) => entry.field === "requestedChange"));
});

test("normalizes editable fields to a stable order for deduplication", () => {
  const result = validateEditProposal(
    validEditProposal({ fields: ["people", "date", "description"] }),
  );

  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.value.fields, ["date", "description", "people"]);
});
