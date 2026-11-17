/**
 * @OnlyCurrentDoc
 *
 * Baller Express Stage 2 staging notifications.
 *
 * Bind this script only to the private staging workbook. Set these Script
 * Properties in the Apps Script project settings; never put their values in
 * this file:
 *
 * - OWNER_EMAIL
 * - STAGING_SPREADSHEET_ID
 * - STAGING_WORKER_URL (https://... with no trailing slash)
 * - ALERT_POLL_SECRET (the same 32+ character Worker secret)
 *
 * The five-minute trigger is installed only when the owner manually runs
 * setupBallerExpressStage2Trigger().
 */

var BALLER_EDIT_SHEET_ = "Edit Proposals";
var BALLER_HEADERS_ = [
  "proposal_id",
  "submission_id",
  "source",
  "submitted_at",
  "original_event_id",
  "original_date",
  "original_description",
  "original_people",
  "fields",
  "requested_change",
  "contributor_name",
  "contributor_email",
  "notification_status",
  "notified_at",
  "review_status",
  "reviewed_at",
  "reviewer_notes",
];
var BALLER_MAIL_QUOTA_RESERVE_ = 10;
var BALLER_PROPOSAL_MAX_ATTEMPTS_ = 8;
var BALLER_RETRY_STATE_KEY_ = "BALLER_PROPOSAL_RETRIES_V1";
var BALLER_DELIVERED_PROPOSALS_KEY_ = "BALLER_DELIVERED_PROPOSALS_V1";
var BALLER_DELIVERED_ALERTS_KEY_ = "BALLER_DELIVERED_ALERTS_V1";
var BALLER_HEALTH_STATE_KEY_ = "BALLER_WORKER_HEALTH_V1";
var BALLER_OUTAGE_THRESHOLD_ = 3;
var BALLER_OUTAGE_COOLDOWN_MS_ = 6 * 60 * 60 * 1000;
var BALLER_ALERT_MEMORY_MS_ = 7 * 24 * 60 * 60 * 1000;

function setupBallerExpressStage2Trigger() {
  ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL);
  ballerConfiguration_();
  ballerEditSheet_();
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === "pollBallerExpressStage2") {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger("pollBallerExpressStage2")
    .timeBased()
    .everyMinutes(5)
    .create();
}

function validateBallerExpressStage2Configuration() {
  ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL);
  ballerConfiguration_();
  ballerEditSheet_();
  return "Stage 2 staging notification configuration is valid.";
}

function pollBallerExpressStage2() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    var config = ballerConfiguration_();
    processBallerEditNotifications_(config);
    try {
      processBallerAggregateAlerts_(config);
      recordBallerWorkerHealthy_(config);
    } catch (ignoredAggregateFailure) {
      recordBallerWorkerFailure_(config);
    }
  } finally {
    lock.releaseLock();
  }
}

function ballerConfiguration_() {
  var properties = PropertiesService.getScriptProperties();
  var config = {
    ownerEmail: properties.getProperty("OWNER_EMAIL"),
    spreadsheetId: properties.getProperty("STAGING_SPREADSHEET_ID"),
    workerUrl: properties.getProperty("STAGING_WORKER_URL"),
    alertSecret: properties.getProperty("ALERT_POLL_SECRET"),
  };
  if (!config.ownerEmail || config.ownerEmail.indexOf("@") < 1) {
    throw new Error("OWNER_EMAIL is missing or invalid.");
  }
  if (!config.spreadsheetId) {
    throw new Error("STAGING_SPREADSHEET_ID is missing.");
  }
  if (
    !config.workerUrl ||
    !/^https:\/\/[^/]+(?:\:[0-9]+)?$/.test(config.workerUrl)
  ) {
    throw new Error("STAGING_WORKER_URL must be an HTTPS origin.");
  }
  if (!config.alertSecret || config.alertSecret.length < 32) {
    throw new Error("ALERT_POLL_SECRET must contain at least 32 characters.");
  }
  return config;
}

function ballerEditSheet_() {
  var spreadsheetId = PropertiesService.getScriptProperties().getProperty(
    "STAGING_SPREADSHEET_ID",
  );
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet || spreadsheet.getId() !== spreadsheetId) {
    throw new Error(
      "This script must remain bound to the configured staging workbook.",
    );
  }
  var sheet = spreadsheet.getSheetByName(BALLER_EDIT_SHEET_);
  if (!sheet) throw new Error("The Edit Proposals sheet is unavailable.");
  var headers = sheet
    .getRange(1, 1, 1, BALLER_HEADERS_.length)
    .getDisplayValues()[0];
  if (
    headers.length !== BALLER_HEADERS_.length ||
    headers.some(function (value, index) {
      return value !== BALLER_HEADERS_[index];
    })
  ) {
    throw new Error("The Edit Proposals schema does not match Stage 2.");
  }
  return sheet;
}

function processBallerEditNotifications_(config) {
  var sheet = ballerEditSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  var rows = sheet
    .getRange(2, 1, lastRow - 1, BALLER_HEADERS_.length)
    .getDisplayValues();
  var retryState = readBallerJsonProperty_(BALLER_RETRY_STATE_KEY_, {});
  var delivered = readBallerJsonProperty_(BALLER_DELIVERED_PROPOSALS_KEY_, {});
  var now = Date.now();
  pruneBallerTimestampMap_(delivered, now - BALLER_ALERT_MEMORY_MS_);

  for (var index = 0; index < rows.length; index += 1) {
    var row = rows[index];
    var status = row[12];
    if (status !== "PENDING" && status !== "RETRY") continue;
    var proposalId = row[0];
    if (!proposalId) continue;
    var retry = retryState[proposalId] || { attempts: 0, nextAttemptAt: 0 };
    if (Number(retry.nextAttemptAt || 0) > now) continue;
    if (delivered[proposalId]) {
      sheet.getRange(index + 2, 13, 1, 2).setValues([
        ["SENT", new Date(Number(delivered[proposalId]))],
      ]);
      delete retryState[proposalId];
      continue;
    }
    if (!ballerHasMailCapacity_()) break;

    try {
      MailApp.sendEmail({
        to: config.ownerEmail,
        subject: "[Baller Express staging] Edit proposal " + proposalId,
        body: ballerProposalEmailBody_(row),
        name: "Baller Express staging",
      });
      delivered[proposalId] = Date.now();
      writeBallerJsonProperty_(BALLER_DELIVERED_PROPOSALS_KEY_, delivered);
      sheet.getRange(index + 2, 13, 1, 2).setValues([
        ["SENT", new Date(Number(delivered[proposalId]))],
      ]);
      delete retryState[proposalId];
    } catch (ignoredMailFailure) {
      if (delivered[proposalId]) {
        // Email succeeded but the Sheet acknowledgement did not. Retain the
        // local delivery marker and repair the Sheet on the next trigger.
        continue;
      }
      var attempts = Number(retry.attempts || 0) + 1;
      if (attempts >= BALLER_PROPOSAL_MAX_ATTEMPTS_) {
        delete retryState[proposalId];
        sheet.getRange(index + 2, 13).setValue("FAILED");
        continue;
      }
      var delayMs = Math.min(
        6 * 60 * 60 * 1000,
        5 * 60 * 1000 * Math.pow(2, Math.min(attempts - 1, 6)),
      );
      retryState[proposalId] = {
        attempts: attempts,
        nextAttemptAt: now + delayMs,
      };
      sheet.getRange(index + 2, 13).setValue("RETRY");
    }
  }
  writeBallerJsonProperty_(BALLER_RETRY_STATE_KEY_, retryState);
  writeBallerJsonProperty_(BALLER_DELIVERED_PROPOSALS_KEY_, delivered);
}

function ballerProposalEmailBody_(row) {
  return [
    "A new edit proposal is waiting in the private staging workbook.",
    "",
    "Proposal ID: " + row[0],
    "Original event ID: " + row[4],
    "Original date: " + row[5],
    "Original description: " + row[6],
    "Original people: " + row[7],
    "Fields to change: " + row[8],
    "Requested change: " + row[9],
    "Contributor name: " + (row[10] || "Not provided"),
    "Contributor email: " + (row[11] || "Not provided"),
    "",
    "Review this proposal in Edit Proposals. It has not been auto-applied.",
  ].join("\n");
}

function processBallerAggregateAlerts_(config) {
  var lease = ballerWorkerRequest_(
    config,
    "/internal/v1/alerts/lease",
    { limit: 5 },
  );
  var alerts = Array.isArray(lease.alerts) ? lease.alerts : [];
  var delivered = readBallerJsonProperty_(BALLER_DELIVERED_ALERTS_KEY_, {});
  pruneBallerTimestampMap_(delivered, Date.now() - BALLER_ALERT_MEMORY_MS_);

  alerts.forEach(function (alert) {
    if (!ballerValidAggregateAlert_(alert)) {
      throw new Error("The Worker returned an invalid aggregate alert.");
    }
    if (delivered[alert.alertId]) {
      ballerWorkerRequest_(config, "/internal/v1/alerts/ack", {
        alertId: alert.alertId,
        leaseToken: alert.leaseToken,
      });
      return;
    }
    if (!ballerHasMailCapacity_()) {
      ballerWorkerRequest_(config, "/internal/v1/alerts/nack", {
        alertId: alert.alertId,
        leaseToken: alert.leaseToken,
        retryAfterSeconds: 5 * 60,
      });
      return;
    }
    try {
      MailApp.sendEmail({
        to: config.ownerEmail,
        subject: "[Baller Express staging] Usage alert: " + alert.rule,
        body: ballerAggregateEmailBody_(alert),
        name: "Baller Express staging",
      });
      delivered[alert.alertId] = Date.now();
      writeBallerJsonProperty_(BALLER_DELIVERED_ALERTS_KEY_, delivered);
      ballerWorkerRequest_(config, "/internal/v1/alerts/ack", {
        alertId: alert.alertId,
        leaseToken: alert.leaseToken,
      });
    } catch (ignoredMailFailure) {
      var retrySeconds = Math.min(
        6 * 60 * 60,
        5 * 60 * Math.pow(2, Math.min(Number(alert.attempts || 1) - 1, 6)),
      );
      ballerWorkerRequest_(config, "/internal/v1/alerts/nack", {
        alertId: alert.alertId,
        leaseToken: alert.leaseToken,
        retryAfterSeconds: retrySeconds,
      });
    }
  });
  writeBallerJsonProperty_(BALLER_DELIVERED_ALERTS_KEY_, delivered);
}

function ballerValidAggregateAlert_(alert) {
  var rules = {
    attempts_10m: true,
    attempts_24h: true,
    accepted_24h: true,
    turnstile_upstream: true,
    sheets_upstream: true,
    google_auth: true,
  };
  return Boolean(
    alert &&
      rules[alert.rule] &&
      typeof alert.alertId === "string" &&
      typeof alert.leaseToken === "string" &&
      Number(alert.count) >= 0 &&
      Number(alert.threshold) > 0 &&
      Number(alert.windowSeconds) > 0,
  );
}

function ballerAggregateEmailBody_(alert) {
  return [
    "The staging submission service crossed a configured safety threshold.",
    "",
    "Alert ID: " + alert.alertId,
    "Rule: " + alert.rule,
    "Observed count: " + alert.count,
    "Threshold: " + alert.threshold,
    "Window (seconds): " + alert.windowSeconds,
    "First observed (Unix seconds): " + alert.firstObservedAt,
    "",
    "This alert contains aggregate operational data only.",
  ].join("\n");
}

function ballerWorkerRequest_(config, path, payload) {
  var body = JSON.stringify(payload);
  var timestamp = Math.floor(Date.now() / 1000).toString();
  var canonical = timestamp + "\nPOST\n" + path + "\n" + body;
  var bytes = Utilities.computeHmacSha256Signature(
    canonical,
    config.alertSecret,
    Utilities.Charset.UTF_8,
  );
  var signature = bytes
    .map(function (value) {
      return ((value + 256) % 256).toString(16).padStart(2, "0");
    })
    .join("");
  var result = UrlFetchApp.fetch(config.workerUrl + path, {
    method: "post",
    contentType: "application/json",
    payload: body,
    headers: {
      "x-baller-timestamp": timestamp,
      "x-baller-signature": signature,
    },
    muteHttpExceptions: true,
    followRedirects: false,
  });
  if (result.getResponseCode() !== 200) {
    throw new Error("The staging alert endpoint is unavailable.");
  }
  var parsed = JSON.parse(result.getContentText());
  if (!parsed || typeof parsed !== "object") {
    throw new Error("The staging alert response is invalid.");
  }
  return parsed;
}

function recordBallerWorkerFailure_(config) {
  var state = readBallerJsonProperty_(BALLER_HEALTH_STATE_KEY_, {
    consecutiveFailures: 0,
    alertSent: false,
    lastAlertAt: 0,
  });
  state.consecutiveFailures = Number(state.consecutiveFailures || 0) + 1;
  var now = Date.now();
  var canAlert =
    state.consecutiveFailures >= BALLER_OUTAGE_THRESHOLD_ &&
    (!state.alertSent ||
      now - Number(state.lastAlertAt || 0) >= BALLER_OUTAGE_COOLDOWN_MS_);
  if (canAlert && ballerHasMailCapacity_()) {
    try {
      MailApp.sendEmail({
        to: config.ownerEmail,
        subject: "[Baller Express staging] Worker alert polling is unavailable",
        body: [
          "The owner-side staging monitor could not reach or authenticate the",
          "aggregate alert endpoint three or more consecutive times.",
          "",
          "Submissions should be treated as unavailable until staging health",
          "is verified. No form payload or contact data is included here.",
        ].join("\n"),
        name: "Baller Express staging",
      });
      state.alertSent = true;
      state.lastAlertAt = now;
    } catch (ignoredOutageMailFailure) {
      // Retry on the next trigger without persisting an error string.
    }
  }
  writeBallerJsonProperty_(BALLER_HEALTH_STATE_KEY_, state);
}

function recordBallerWorkerHealthy_(config) {
  var state = readBallerJsonProperty_(BALLER_HEALTH_STATE_KEY_, {
    consecutiveFailures: 0,
    alertSent: false,
    lastAlertAt: 0,
  });
  if (state.alertSent && ballerHasMailCapacity_()) {
    try {
      MailApp.sendEmail({
        to: config.ownerEmail,
        subject: "[Baller Express staging] Alert polling recovered",
        body: "The owner-side staging monitor reached the aggregate alert endpoint again.",
        name: "Baller Express staging",
      });
      state.alertSent = false;
      state.lastAlertAt = 0;
    } catch (ignoredRecoveryMailFailure) {
      // Keep alertSent=true so the next successful poll can retry recovery mail.
    }
  }
  state.consecutiveFailures = 0;
  writeBallerJsonProperty_(BALLER_HEALTH_STATE_KEY_, state);
}

function ballerHasMailCapacity_() {
  return MailApp.getRemainingDailyQuota() > BALLER_MAIL_QUOTA_RESERVE_;
}

function readBallerJsonProperty_(key, fallback) {
  var raw = PropertiesService.getScriptProperties().getProperty(key);
  if (!raw) return fallback;
  try {
    var value = JSON.parse(raw);
    return value && typeof value === "object" ? value : fallback;
  } catch (ignoredInvalidState) {
    return fallback;
  }
}

function writeBallerJsonProperty_(key, value) {
  PropertiesService.getScriptProperties().setProperty(
    key,
    JSON.stringify(value),
  );
}

function pruneBallerTimestampMap_(value, cutoff) {
  Object.keys(value).forEach(function (key) {
    if (Number(value[key] || 0) < cutoff) delete value[key];
  });
}
