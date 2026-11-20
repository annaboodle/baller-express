import { createSubmissionApp } from "./app.js";
import { createD1AlertStore } from "./alerts/d1-alert-store.js";
import { createInternalAlertApi } from "./alerts/internal-api.js";
import { createAlertTelemetry } from "./alerts/telemetry.js";
import { createD1RateLimiter } from "./adapters/d1-rate-limiter.js";
import { createD1SheetsRepository } from "./adapters/d1-sheets-repository.js";
import { createTurnstileVerifier } from "./adapters/turnstile.js";

export function createRuntimeApp(options = {}) {
  const alertStore = options.alertStore || createD1AlertStore();
  const telemetry =
    options.telemetry ||
    createAlertTelemetry({
      store: alertStore,
      now: options.now,
      randomUuid: options.randomUuid,
    });
  const internalAlerts =
    options.internalAlerts ||
    createInternalAlertApi({
      store: alertStore,
      cleanup: (context) => telemetry.cleanup(context),
      now: options.now,
      randomUuid: options.randomUuid,
      cryptoImpl: options.cryptoImpl,
    });
  const submissions = createSubmissionApp({
    rateLimiter: options.rateLimiter || createD1RateLimiter(options),
    turnstile: options.turnstile || createTurnstileVerifier(options),
    repository: options.repository || createD1SheetsRepository(options),
    telemetry,
  });

  return Object.freeze({
    fetch(request, env, executionContext) {
      const path = new URL(request.url).pathname;
      if (path.startsWith("/internal/v1/alerts/")) {
        return internalAlerts.handle(request, env);
      }
      return submissions.fetch(request, env, executionContext);
    },
  });
}
