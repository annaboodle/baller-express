import {
  UPSTREAM_FAILURE_CATEGORIES,
  UpstreamDependencyError,
} from "./upstream-error.js";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const DEFAULT_TIMEOUT_MS = 8_000;

function unavailable() {
  return new UpstreamDependencyError(
    UPSTREAM_FAILURE_CATEGORIES.turnstile,
    "Turnstile verification was unavailable.",
  );
}

export function createTurnstileVerifier({
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required.");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("The Turnstile timeout must be a positive integer.");
  }

  return Object.freeze({
    async verify({ env, token, expectedAction, expectedHostname, sourceIp }) {
      const secret = env?.TURNSTILE_SECRET_KEY;
      if (typeof secret !== "string" || secret.length === 0) {
        throw unavailable();
      }
      if (
        typeof token !== "string" ||
        typeof expectedAction !== "string" ||
        typeof expectedHostname !== "string"
      ) {
        throw new Error("Turnstile verification context is incomplete.");
      }

      const form = new URLSearchParams({ secret, response: token });
      if (typeof sourceIp === "string" && sourceIp.length > 0) {
        form.set("remoteip", sourceIp);
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let result;
      try {
        const response = await fetchImpl(VERIFY_URL, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: form,
          signal: controller.signal,
        });
        if (!response.ok) {
          throw unavailable();
        }
        result = await response.json();
      } catch (error) {
        if (error instanceof UpstreamDependencyError) {
          throw error;
        }
        throw unavailable();
      } finally {
        clearTimeout(timer);
      }
      return {
        success:
          result?.success === true &&
          result.action === expectedAction &&
          result.hostname === expectedHostname,
      };
    },
  });
}
