(function () {
  "use strict";

  var state = {
    config: null,
    domReady: false,
    initialized: false,
    lastCreatedRequest: null,
    pending: { milestone: null, edit: null },
    turnstileReady: false,
    widgets: { milestone: null, edit: null },
  };

  function element(id) {
    return document.getElementById(id);
  }

  function setStatus(id, message, kind) {
    var target = element(id);
    target.textContent = message;
    target.dataset.kind = kind || "";
  }

  function people(value) {
    return value
      .split(",")
      .map(function (name) {
        return name.trim();
      })
      .filter(Boolean);
  }

  function optional(value) {
    var normalized = value.trim();
    return normalized || undefined;
  }

  function milestonePayload() {
    var form = element("milestone-form");
    var data = new FormData(form);
    return {
      requestId: crypto.randomUUID(),
      type: data.get("type"),
      date: data.get("date"),
      approximate: data.get("approximate") === "on",
      description: data.get("description"),
      people: people(data.get("people")),
      contributorName: optional(data.get("contributorName")),
      contributorEmail: optional(data.get("contributorEmail")),
    };
  }

  function editPayload() {
    var form = element("edit-form");
    var data = new FormData(form);
    return {
      requestId: crypto.randomUUID(),
      original: {
        eventId: data.get("eventId"),
        date: data.get("originalDate"),
        description: data.get("originalDescription"),
        people: people(data.get("originalPeople")),
      },
      fields: data.getAll("fields"),
      requestedChange: data.get("requestedChange"),
      contributorName: optional(data.get("contributorName")),
      contributorEmail: optional(data.get("contributorEmail")),
    };
  }

  function routeFor(kind) {
    return kind === "milestone" ? "/v1/milestones" : "/v1/edit-proposals";
  }

  function statusIdFor(kind) {
    return kind === "milestone" ? "milestone-status" : "edit-status";
  }

  function submitIdFor(kind) {
    return kind === "milestone" ? "milestone-submit" : "edit-submit";
  }

  function safeResponseText(status, body) {
    return "HTTP " + status + "\n" + JSON.stringify(body, null, 2);
  }

  async function post(kind, body, options) {
    var response;
    var result;
    try {
      response = await fetch(state.config.workerOrigin + routeFor(kind), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      result = await response.json();
    } catch (_ignoredNetworkDetails) {
      setStatus(
        (options && options.statusId) || statusIdFor(kind),
        "The staging request failed before a safe response was received.",
        "error",
      );
      return null;
    }

    element("response-output").textContent = safeResponseText(
      response.status,
      result,
    );
    var statusId = (options && options.statusId) || statusIdFor(kind);
    setStatus(
      statusId,
      response.ok ? "Request completed." : "Request was safely rejected.",
      response.ok ? "success" : "error",
    );
    return { body: result, status: response.status };
  }

  async function submitVerified(kind, token) {
    var queued = state.pending[kind];
    state.pending[kind] = null;
    if (!queued) {
      window.turnstile.reset(state.widgets[kind]);
      return;
    }

    var request = Object.assign({}, queued, { turnstileToken: token });
    var result = await post(kind, request);
    request.turnstileToken = "";
    if (result && result.status === 201 && result.body && result.body.ok === true) {
      state.lastCreatedRequest = {
        body: queued,
        kind: kind,
      };
      element("replay-button").disabled = false;
      element("conflict-button").disabled = false;
    }
    window.turnstile.reset(state.widgets[kind]);
    element(submitIdFor(kind)).disabled = false;
  }

  function verificationFailed(kind, message) {
    state.pending[kind] = null;
    setStatus(statusIdFor(kind), message, "error");
    element(submitIdFor(kind)).disabled = false;
  }

  function renderWidget(kind, container, action) {
    state.widgets[kind] = window.turnstile.render(container, {
      sitekey: state.config.turnstileSiteKey,
      action: action,
      execution: "execute",
      appearance: "interaction-only",
      callback: function (token) {
        submitVerified(kind, token);
      },
      "error-callback": function () {
        verificationFailed(
          kind,
          "Human verification could not start. Reset and try again.",
        );
      },
      "expired-callback": function () {
        verificationFailed(kind, "Human verification expired. Try again.");
      },
      "timeout-callback": function () {
        verificationFailed(kind, "Human verification timed out. Try again.");
      },
    });
  }

  function queueVerified(kind, payload) {
    state.pending[kind] = payload;
    element(submitIdFor(kind)).disabled = true;
    setStatus(statusIdFor(kind), "Completing human verification…", "pending");
    window.turnstile.execute(state.widgets[kind]);
  }

  async function idempotencyRequest(conflict) {
    var prior = state.lastCreatedRequest;
    if (!prior) return;
    var body = JSON.parse(JSON.stringify(prior.body));
    body.turnstileToken = "pre-verification-placeholder";
    if (conflict) {
      if (prior.kind === "milestone") {
        body.description += " (conflicting retry)";
      } else {
        body.requestedChange += " (conflicting retry)";
      }
    }
    element("replay-button").disabled = true;
    element("conflict-button").disabled = true;
    await post(prior.kind, body, { statusId: "idempotency-status" });
    body.turnstileToken = "";
    element("replay-button").disabled = false;
    element("conflict-button").disabled = false;
  }

  function initialize() {
    if (
      state.initialized ||
      !state.domReady ||
      !state.turnstileReady ||
      !state.config
    ) {
      return;
    }
    state.initialized = true;
    renderWidget("milestone", "#milestone-turnstile", "add_milestone");
    renderWidget("edit", "#edit-turnstile", "edit_proposal");
    element("milestone-submit").disabled = false;
    element("edit-submit").disabled = false;
    setStatus(
      "startup-status",
      "Ready. The verification token is sent directly and is never shown or logged.",
      "success",
    );
  }

  window.onTurnstileLoad = function () {
    state.turnstileReady = true;
    initialize();
  };

  document.addEventListener("DOMContentLoaded", async function () {
    state.domReady = true;
    element("milestone-form").elements.description.value =
      "Fictional staging milestone " + crypto.randomUUID().slice(0, 8);

    element("milestone-form").addEventListener("submit", function (event) {
      event.preventDefault();
      queueVerified("milestone", milestonePayload());
    });
    element("edit-form").addEventListener("submit", function (event) {
      event.preventDefault();
      queueVerified("edit", editPayload());
    });
    element("replay-button").addEventListener("click", function () {
      idempotencyRequest(false);
    });
    element("conflict-button").addEventListener("click", function () {
      idempotencyRequest(true);
    });

    try {
      var response = await fetch("/config.json", { cache: "no-store" });
      if (!response.ok) throw new Error("configuration unavailable");
      state.config = await response.json();
    } catch (_ignoredConfigurationDetails) {
      setStatus(
        "startup-status",
        "The local staging configuration could not be loaded.",
        "error",
      );
      return;
    }
    initialize();
  });
})();
