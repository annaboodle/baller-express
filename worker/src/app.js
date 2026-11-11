import { BODY_LIMIT_BYTES, PUBLIC_EVENT_FIELDS, ROUTES } from "./contracts.js";
import { validateEditProposal, validateMilestone } from "./validation.js";

const validators = Object.freeze({
  milestone: validateMilestone,
  editProposal: validateEditProposal,
});

class DependencyUnavailableError extends Error {}

const unavailableAdapter = Object.freeze({
  async check() {
    throw new DependencyUnavailableError();
  },
  async verify() {
    throw new DependencyUnavailableError();
  },
  async findReplay() {
    throw new DependencyUnavailableError();
  },
  async createMilestone() {
    throw new DependencyUnavailableError();
  },
  async createEditProposal() {
    throw new DependencyUnavailableError();
  },
});

function responseHeaders(origin) {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  if (origin) {
    headers.set("access-control-allow-origin", origin);
    headers.set("vary", "Origin");
  }
  return headers;
}

function jsonResponse(status, body, origin, extraHeaders = {}) {
  const headers = responseHeaders(origin);
  for (const [name, value] of Object.entries(extraHeaders)) {
    headers.set(name, value);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function errorResponse(status, code, message, origin, fields) {
  const error = { code, message };
  if (fields) error.fields = fields;
  return jsonResponse(status, { ok: false, error }, origin);
}

function isJsonContentType(request) {
  const value = request.headers.get("content-type") || "";
  return value.toLowerCase().split(";", 1)[0].trim() === "application/json";
}

async function readJsonBody(request) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > BODY_LIMIT_BYTES) {
    return { tooLarge: true };
  }

  if (!request.body) return { invalidJson: true };

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  let receivedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (receivedBytes > BODY_LIMIT_BYTES) {
      await reader.cancel();
      return { tooLarge: true };
    }
    raw += decoder.decode(value, { stream: true });
  }
  raw += decoder.decode();

  try {
    return { value: JSON.parse(raw) };
  } catch {
    return { invalidJson: true };
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isValidSuccessResult(result, route) {
  if (!result || !["created", "replay"].includes(result.kind)) return false;
  if (!isNonEmptyString(result.submissionId)) return false;
  if (route.kind !== "milestone") return true;
  if (!result.event || typeof result.event !== "object") return false;
  return PUBLIC_EVENT_FIELDS.every((field) =>
    isNonEmptyString(result.event[field]),
  );
}

function publicResult(result, route) {
  const body = {
    ok: true,
    submissionId: result.submissionId,
  };
  if (route.kind === "milestone") {
    body.event = Object.fromEntries(
      PUBLIC_EVENT_FIELDS.filter((field) => result.event[field] !== undefined).map(
        (field) => [field, result.event[field]],
      ),
    );
  }
  return body;
}

export function createSubmissionApp({
  rateLimiter = unavailableAdapter,
  turnstile = unavailableAdapter,
  repository = unavailableAdapter,
} = {}) {
  return {
    async fetch(request, env = {}) {
      const url = new URL(request.url);
      const route = ROUTES[url.pathname];
      if (!route) {
        return errorResponse(404, "not_found", "Endpoint not found.");
      }

      const requestOrigin = request.headers.get("origin");
      const sourceIp = request.headers.get("cf-connecting-ip");
      const allowedOrigin = env.ALLOWED_ORIGIN;
      const originMatches =
        typeof allowedOrigin === "string" && requestOrigin === allowedOrigin;

      if (request.method === "OPTIONS") {
        if (!originMatches) {
          return errorResponse(403, "origin_not_allowed", "Origin not allowed.");
        }
        const headers = responseHeaders(allowedOrigin);
        headers.set("access-control-allow-methods", "POST, OPTIONS");
        headers.set("access-control-allow-headers", "Content-Type");
        headers.delete("content-type");
        return new Response(null, { status: 204, headers });
      }

      if (request.method !== "POST") {
        return errorResponse(
          405,
          "method_not_allowed",
          "Only POST is allowed.",
          undefined,
          undefined,
        );
      }

      if (typeof allowedOrigin !== "string" || allowedOrigin.length === 0) {
        return errorResponse(
          503,
          "service_unavailable",
          "Submissions are temporarily unavailable.",
        );
      }
      if (env.SUBMISSIONS_ENABLED !== "true") {
        return errorResponse(
          503,
          "service_unavailable",
          "Submissions are temporarily unavailable.",
          allowedOrigin,
        );
      }

      try {
        const rateLimit = await rateLimiter.check({
          env,
          endpoint: url.pathname,
          sourceIp,
        });
        if (!rateLimit?.allowed) {
          const retryAfterSeconds = Math.max(
            1,
            Number(rateLimit?.retryAfterSeconds) || 60,
          );
          return jsonResponse(
            429,
            {
              ok: false,
              error: {
                code: "rate_limited",
                message: "Too many attempts. Please try again later.",
              },
            },
            allowedOrigin,
            { "retry-after": String(retryAfterSeconds) },
          );
        }
      } catch {
        return errorResponse(
          503,
          "service_unavailable",
          "Submissions are temporarily unavailable.",
          allowedOrigin,
        );
      }

      if (!originMatches) {
        return errorResponse(403, "origin_not_allowed", "Origin not allowed.");
      }

      if (!isJsonContentType(request)) {
        return errorResponse(
          415,
          "unsupported_media_type",
          "Content-Type must be application/json.",
          allowedOrigin,
        );
      }

      let parsed;
      try {
        parsed = await readJsonBody(request);
      } catch {
        return errorResponse(
          400,
          "invalid_body",
          "Request body could not be read.",
          allowedOrigin,
        );
      }
      if (parsed.tooLarge) {
        return errorResponse(
          413,
          "body_too_large",
          "Request body is too large.",
          allowedOrigin,
        );
      }
      if (parsed.invalidJson) {
        return errorResponse(
          400,
          "invalid_json",
          "Request body must be valid JSON.",
          allowedOrigin,
        );
      }

      const validation = validators[route.validator](parsed.value);
      if (validation.issues.length > 0) {
        return errorResponse(
          400,
          "invalid_submission",
          "Check the highlighted fields and try again.",
          allowedOrigin,
          validation.issues,
        );
      }

      const { turnstileToken, ...storageSubmission } = validation.value;

      let priorResult;
      try {
        priorResult = await repository.findReplay({
          endpoint: url.pathname,
          env,
          submission: storageSubmission,
        });
      } catch {
        return errorResponse(
          503,
          "service_unavailable",
          "Submissions are temporarily unavailable.",
          allowedOrigin,
        );
      }

      if (priorResult?.kind === "conflict") {
        return errorResponse(
          409,
          "request_id_conflict",
          "This request ID was already used for different content.",
          allowedOrigin,
        );
      }
      if (priorResult?.kind === "replay") {
        if (!isValidSuccessResult(priorResult, route)) {
          return errorResponse(
            503,
            "service_unavailable",
            "Submissions are temporarily unavailable.",
            allowedOrigin,
          );
        }
        return jsonResponse(
          200,
          publicResult(priorResult, route),
          allowedOrigin,
        );
      }
      if (priorResult !== null && priorResult !== undefined) {
        return errorResponse(
          503,
          "service_unavailable",
          "Submissions are temporarily unavailable.",
          allowedOrigin,
        );
      }

      try {
        const verification = await turnstile.verify({
          env,
          token: turnstileToken,
          expectedAction: route.action,
          expectedHostname: new URL(allowedOrigin).hostname,
          sourceIp,
        });
        if (!verification?.success) {
          return errorResponse(
            403,
            "verification_failed",
            "Human verification failed. Please try again.",
            allowedOrigin,
          );
        }

        const result = await repository[route.repositoryMethod]({
          endpoint: url.pathname,
          env,
          ownerFields: route.ownerFields,
          submission: storageSubmission,
        });

        if (result?.kind === "duplicate") {
          return errorResponse(
            409,
            "duplicate_submission",
            "This submission was already received.",
            allowedOrigin,
          );
        }
        if (result?.kind === "conflict") {
          return errorResponse(
            409,
            "request_id_conflict",
            "This request ID was already used for different content.",
            allowedOrigin,
          );
        }
        if (!isValidSuccessResult(result, route)) {
          throw new DependencyUnavailableError();
        }
        const status = result.kind === "replay" ? 200 : 201;
        return jsonResponse(status, publicResult(result, route), allowedOrigin);
      } catch {
        return errorResponse(
          503,
          "service_unavailable",
          "Submissions are temporarily unavailable.",
          allowedOrigin,
        );
      }
    },
  };
}
