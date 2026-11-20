import React, { useEffect, useRef, useState } from "react";

import TurnstileWidget from "./TurnstileWidget";
import useVerifiedSubmission from "../hooks/useVerifiedSubmission";
import { normalizePeople, SubmissionError } from "../submissions";

const MILESTONE_TYPES = ["event", "intro", "move", "trip"];

export default function AddMilestoneForm({
  submissionConfig,
  submissionApi,
  onAccepted,
  onDuplicate,
  onBusyChange,
  addEventType,
  updateAddEventType,
  addEventDate,
  updateAddEventDate,
  addEventPrecise,
  updateAddEventPrecise,
  addEventDesc,
  updateAddEventDesc,
  addEventCheckboxes,
  selectedPeople,
  addEventOtherPeople,
  updateAddEventOtherPeople,
}) {
  const controllerRef = useRef(null);
  const [verificationReady, setVerificationReady] = useState(false);
  const [contributorName, setContributorName] = useState("");
  const [contributorEmail, setContributorEmail] = useState("");

  const flow = useVerifiedSubmission({
    submit: submissionApi.submitMilestone,
    onSuccess: onAccepted,
    onDuplicate,
  });

  useEffect(() => {
    onBusyChange(flow.busy);
  }, [flow.busy, onBusyChange]);

  function handleSubmit(event) {
    event.preventDefault();
    if (!submissionConfig.available) {
      flow.setLocalError(submissionConfig.message);
      return;
    }

    try {
      const people = normalizePeople(selectedPeople, addEventOtherPeople);
      if (addEventDate < "1971-01-01") {
        throw new SubmissionError(
          "invalid_date",
          "Choose a date on or after January 1, 1971.",
        );
      }
      flow.begin(
        {
          type: addEventType,
          date: addEventDate,
          approximate: addEventPrecise,
          description: addEventDesc,
          people,
          ...(contributorName.trim()
            ? { contributorName: contributorName.trim() }
            : {}),
          ...(contributorEmail.trim()
            ? { contributorEmail: contributorEmail.trim() }
            : {}),
        },
        controllerRef.current,
      );
    } catch (error) {
      flow.setLocalError(error);
    }
  }

  return (
    <form className="form" onSubmit={handleSubmit} aria-busy={flow.busy}>
      <h2 className="form-title" id="add-milestone-title">
        Add a milestone
      </h2>

      {!submissionConfig.available && (
        <p className="form-alert" role="alert">
          {submissionConfig.message}
        </p>
      )}

      <fieldset className="form-fieldset">
        <legend className="form-label">What type of milestone is it?</legend>
        {MILESTONE_TYPES.map((type) => (
          <div className="form-field form-field--radio" key={type}>
            <label className="radio-container">
              {type}
              <input
                name="milestone-type"
                type="radio"
                value={type}
                required
                checked={addEventType === type}
                onChange={() => updateAddEventType(type)}
              />
              <span className="checkmark" />
            </label>
          </div>
        ))}
      </fieldset>

      <div className="form-flex form-flex-date">
        <div className="form-field">
          <label className="form-label" htmlFor="milestone-date">
            When did it happen?
          </label>
          <p className="form-help">
            Please enter a full date, even if you're not 100% sure.
          </p>
          <input
            id="milestone-date"
            onChange={(event) => updateAddEventDate(event.target.value)}
            type="date"
            min="1971-01-01"
            required
            value={addEventDate}
          />
        </div>

        <div className="form-field form-field--checkbox form-field--checkbox-date">
          <label className="checkbox-container">
            This date isn't exact, but it's close!
            <input
              type="checkbox"
              onChange={(event) =>
                updateAddEventPrecise(event.target.checked)
              }
              checked={addEventPrecise}
            />
            <span className="checkmark" />
          </label>
        </div>
      </div>

      <div className="form-field">
        <label className="form-label" htmlFor="milestone-description">
          What happened?
        </label>
        <p className="form-help">
          This will be the milestone description. Everything you include will be
          visible on the timeline!
        </p>
        <textarea
          id="milestone-description"
          onChange={(event) => updateAddEventDesc(event.target.value)}
          value={addEventDesc}
          required
          maxLength="500"
        />
      </div>

      <fieldset className="form-fieldset">
        <legend className="form-label">Who was involved?</legend>
        <div className="form-field--checkbox-wrap">{addEventCheckboxes}</div>
      </fieldset>

      <div className="form-field">
        <label className="form-label" htmlFor="milestone-other-people">
          Anyone else?
        </label>
        <p className="form-help">Separate each name by a comma.</p>
        <input
          id="milestone-other-people"
          onChange={(event) => updateAddEventOtherPeople(event.target.value)}
          value={addEventOtherPeople}
          type="text"
        />
      </div>

      <div className="form-flex">
        <div className="form-field">
          <label className="form-label" htmlFor="milestone-contributor-name">
            Your name
          </label>
          <input
            id="milestone-contributor-name"
            value={contributorName}
            maxLength="80"
            onChange={(event) => setContributorName(event.target.value)}
            type="text"
            autoComplete="name"
          />
        </div>
        <div className="form-field">
          <label className="form-label" htmlFor="milestone-contributor-email">
            Your email
          </label>
          <input
            id="milestone-contributor-email"
            value={contributorEmail}
            maxLength="254"
            onChange={(event) => setContributorEmail(event.target.value)}
            type="email"
            autoComplete="email"
          />
        </div>
      </div>

      <p>
        Once you submit, your milestone will be immediately added to the
        timeline. Make sure it looks good!!!
      </p>

      {submissionConfig.available && (
        <TurnstileWidget
          siteKey={submissionConfig.siteKey}
          action="add_milestone"
          onReady={(controller) => {
            controllerRef.current = controller;
            setVerificationReady(Boolean(controller));
          }}
          onToken={(token) =>
            flow.acceptToken(token, controllerRef.current)
          }
          onFailure={(message) =>
            flow.failChallenge(message, controllerRef.current)
          }
        />
      )}

      {flow.busy && (
        <p className="form-status" role="status">
          Verifying and sending your milestone…
        </p>
      )}
      {flow.error && (
        <p className="form-alert" role="alert">
          {flow.error}
        </p>
      )}

      <button
        className="form-submit"
        type="submit"
        disabled={
          flow.busy || !submissionConfig.available || !verificationReady
        }
      >
        {flow.busy ? "Submitting…" : "Submit milestone"}
      </button>
    </form>
  );
}
