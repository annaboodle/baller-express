export const METRICS = Object.freeze({
  ATTEMPT: "attempt",
  ACCEPTED: "accepted",
  FAILURE_TURNSTILE: "failure_turnstile",
  FAILURE_SHEETS: "failure_sheets",
  FAILURE_GOOGLE_AUTH: "failure_google_auth",
});

export const FAILURE_METRIC = Object.freeze({
  turnstile: METRICS.FAILURE_TURNSTILE,
  sheets: METRICS.FAILURE_SHEETS,
  google_auth: METRICS.FAILURE_GOOGLE_AUTH,
});

export const ALERT_RULES = Object.freeze([
  Object.freeze({
    key: "attempts_10m",
    metric: METRICS.ATTEMPT,
    threshold: 100,
    windowSeconds: 10 * 60,
    cooldownSeconds: 60 * 60,
  }),
  Object.freeze({
    key: "attempts_24h",
    metric: METRICS.ATTEMPT,
    threshold: 1_000,
    windowSeconds: 24 * 60 * 60,
    cooldownSeconds: 24 * 60 * 60,
  }),
  Object.freeze({
    key: "accepted_24h",
    metric: METRICS.ACCEPTED,
    threshold: 50,
    windowSeconds: 24 * 60 * 60,
    cooldownSeconds: 24 * 60 * 60,
  }),
  Object.freeze({
    key: "turnstile_upstream",
    metric: METRICS.FAILURE_TURNSTILE,
    threshold: 3,
    windowSeconds: 10 * 60,
    cooldownSeconds: 60 * 60,
  }),
  Object.freeze({
    key: "sheets_upstream",
    metric: METRICS.FAILURE_SHEETS,
    threshold: 3,
    windowSeconds: 10 * 60,
    cooldownSeconds: 60 * 60,
  }),
  Object.freeze({
    key: "google_auth",
    metric: METRICS.FAILURE_GOOGLE_AUTH,
    threshold: 3,
    windowSeconds: 10 * 60,
    cooldownSeconds: 60 * 60,
  }),
]);

const rulesByMetric = new Map();
for (const rule of ALERT_RULES) {
  const current = rulesByMetric.get(rule.metric) || [];
  current.push(rule);
  rulesByMetric.set(rule.metric, current);
}
for (const [metric, rules] of rulesByMetric.entries()) {
  rulesByMetric.set(metric, Object.freeze(rules));
}

export function rulesForMetric(metric) {
  return rulesByMetric.get(metric) || Object.freeze([]);
}

export function isKnownRule(ruleKey) {
  return ALERT_RULES.some((rule) => rule.key === ruleKey);
}
