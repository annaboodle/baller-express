export const UPSTREAM_FAILURE_CATEGORIES = Object.freeze({
  turnstile: "turnstile",
  googleAuth: "google_auth",
  sheets: "sheets",
});

const ALLOWED_CATEGORIES = new Set(
  Object.values(UPSTREAM_FAILURE_CATEGORIES),
);

export class UpstreamDependencyError extends Error {
  constructor(category, message) {
    if (!ALLOWED_CATEGORIES.has(category)) {
      throw new Error("The upstream failure category is invalid.");
    }
    super(message);
    this.name = "UpstreamDependencyError";
    this.category = category;
  }
}

export function upstreamFailureCategory(error) {
  return error instanceof UpstreamDependencyError ? error.category : null;
}
