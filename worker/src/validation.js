import {
  EDIT_FIELDS,
  EDIT_PROPOSAL_FIELDS,
  MILESTONE_FIELDS,
  MILESTONE_TYPES,
} from "./contracts.js";

const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function issue(field, code, message) {
  return { field, code, message };
}

function normalizedString(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : null;
}

function validateText(value, field, { min = 1, max }) {
  const normalized = normalizedString(value);
  if (normalized === null || normalized.length < min || normalized.length > max) {
    return {
      value: normalized,
      issue: issue(
        field,
        "invalid_length",
        `${field} must contain between ${min} and ${max} characters.`,
      ),
    };
  }
  return { value: normalized };
}

function validateOptionalText(value, field, max) {
  if (value === undefined || value === null || value === "") {
    return { value: null };
  }
  return validateText(value, field, { min: 1, max });
}

function validateRequestId(value) {
  if (typeof value !== "string" || !REQUEST_ID_PATTERN.test(value)) {
    return issue("requestId", "invalid_request_id", "requestId must be a UUID.");
  }
  return null;
}

function validateToken(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 2048) {
    return issue(
      "turnstileToken",
      "invalid_token",
      "Human verification is required.",
    );
  }
  return null;
}

function validateIsoDate(value, field = "date") {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return issue(field, "invalid_date", `${field} must use YYYY-MM-DD.`);
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const isRealDate =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;

  if (!isRealDate || value < "1971-01-01") {
    return issue(
      field,
      "invalid_date",
      `${field} must be a real date on or after 1971-01-01.`,
    );
  }
  return null;
}

function validatePeople(value, field = "people") {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    return {
      issue: issue(
        field,
        "invalid_people",
        `${field} must contain between 1 and 100 people.`,
      ),
    };
  }

  const normalized = [];
  const seen = new Set();
  for (const person of value) {
    const result = validateText(person, field, { min: 1, max: 80 });
    if (result.issue) return { issue: result.issue };
    const key = result.value.toLocaleLowerCase("en-US");
    if (seen.has(key)) {
      return {
        issue: issue(field, "duplicate_person", `${field} must be unique.`),
      };
    }
    seen.add(key);
    normalized.push(result.value);
  }
  return { value: normalized };
}

function validateEmail(value) {
  if (value === undefined || value === null || value === "") {
    return { value: null };
  }
  const normalized = normalizedString(value);
  if (
    normalized === null ||
    normalized.length > 254 ||
    !EMAIL_PATTERN.test(normalized)
  ) {
    return {
      value: normalized,
      issue: issue(
        "contributorEmail",
        "invalid_email",
        "contributorEmail must be a valid email address.",
      ),
    };
  }
  return { value: normalized };
}

function rejectUnknownFields(payload, allowedFields) {
  return Object.keys(payload)
    .filter((field) => !allowedFields.includes(field))
    .map((field) =>
      issue(field, "unknown_field", `${field} is not accepted by this endpoint.`),
    );
}

function validateCommon(payload, allowedFields) {
  if (!isPlainObject(payload)) {
    return {
      issues: [issue("body", "invalid_body", "Request body must be an object.")],
    };
  }

  const issues = rejectUnknownFields(payload, allowedFields);
  const requestIdIssue = validateRequestId(payload.requestId);
  const tokenIssue = validateToken(payload.turnstileToken);
  if (requestIdIssue) issues.push(requestIdIssue);
  if (tokenIssue) issues.push(tokenIssue);

  const contributorName = validateOptionalText(
    payload.contributorName,
    "contributorName",
    80,
  );
  const contributorEmail = validateEmail(payload.contributorEmail);
  if (contributorName.issue) issues.push(contributorName.issue);
  if (contributorEmail.issue) issues.push(contributorEmail.issue);

  return {
    issues,
    common: {
      requestId: payload.requestId,
      turnstileToken: payload.turnstileToken,
      contributorName: contributorName.value,
      contributorEmail: contributorEmail.value,
    },
  };
}

export function validateMilestone(payload) {
  const commonResult = validateCommon(payload, MILESTONE_FIELDS);
  if (!commonResult.common) return commonResult;
  const { issues, common } = commonResult;

  if (!MILESTONE_TYPES.includes(payload.type)) {
    issues.push(
      issue("type", "invalid_type", "type must be an allowed milestone type."),
    );
  }
  const dateIssue = validateIsoDate(payload.date);
  if (dateIssue) issues.push(dateIssue);
  if (typeof payload.approximate !== "boolean") {
    issues.push(
      issue("approximate", "invalid_boolean", "approximate must be a boolean."),
    );
  }

  const description = validateText(payload.description, "description", {
    min: 1,
    max: 500,
  });
  const people = validatePeople(payload.people);
  if (description.issue) issues.push(description.issue);
  if (people.issue) issues.push(people.issue);

  return {
    issues,
    value:
      issues.length === 0
        ? {
            ...common,
            type: payload.type,
            date: payload.date,
            approximate: payload.approximate,
            description: description.value,
            people: people.value,
          }
        : undefined,
  };
}

export function validateEditProposal(payload) {
  const commonResult = validateCommon(payload, EDIT_PROPOSAL_FIELDS);
  if (!commonResult.common) return commonResult;
  const { issues, common } = commonResult;

  if (!isPlainObject(payload.original)) {
    issues.push(
      issue("original", "invalid_original", "original milestone is required."),
    );
  }

  let original;
  if (isPlainObject(payload.original)) {
    const originalDateIssue = validateIsoDate(payload.original.date, "original.date");
    const originalDescription = validateText(
      payload.original.description,
      "original.description",
      { min: 1, max: 500 },
    );
    const originalPeople = validatePeople(
      payload.original.people,
      "original.people",
    );
    const originalUnknown = rejectUnknownFields(payload.original, [
      "date",
      "description",
      "people",
    ]);
    issues.push(...originalUnknown);
    if (originalDateIssue) issues.push(originalDateIssue);
    if (originalDescription.issue) issues.push(originalDescription.issue);
    if (originalPeople.issue) issues.push(originalPeople.issue);

    if (
      !originalDateIssue &&
      !originalDescription.issue &&
      !originalPeople.issue &&
      originalUnknown.length === 0
    ) {
      original = {
        date: payload.original.date,
        description: originalDescription.value,
        people: originalPeople.value,
      };
    }
  }

  let fields;
  if (
    !Array.isArray(payload.fields) ||
    payload.fields.length < 1 ||
    payload.fields.some((field) => !EDIT_FIELDS.includes(field)) ||
    new Set(payload.fields).size !== payload.fields.length
  ) {
    issues.push(
      issue(
        "fields",
        "invalid_fields",
        "fields must contain unique editable field names.",
      ),
    );
  } else {
    fields = [...payload.fields];
  }

  const requestedChange = validateText(
    payload.requestedChange,
    "requestedChange",
    { min: 1, max: 1000 },
  );
  if (requestedChange.issue) issues.push(requestedChange.issue);

  return {
    issues,
    value:
      issues.length === 0
        ? {
            ...common,
            original,
            fields,
            requestedChange: requestedChange.value,
          }
        : undefined,
  };
}
