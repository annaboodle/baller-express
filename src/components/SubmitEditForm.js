import React, { useEffect, useRef, useState } from "react";

import TurnstileWidget from "./TurnstileWidget";
import useVerifiedSubmission from "../hooks/useVerifiedSubmission";
import { parsePeople, toIsoDate } from "../submissions";

export default function SubmitEditForm({
  submissionConfig,
  submissionApi,
  milestone,
  onAccepted,
  onDuplicate,
  onBusyChange,
}) {
  const controllerRef = useRef(null);
  const [verificationReady, setVerificationReady] = useState(false);
  const [dateChecked, setDateChecked] = useState(false);
  const [peopleChecked, setPeopleChecked] = useState(false);
  const [descriptionChecked, setDescriptionChecked] = useState(false);
  const [requestedChange, setRequestedChange] = useState("");
  const [contributorName, setContributorName] = useState("");
  const [contributorEmail, setContributorEmail] = useState("");

  const flow = useVerifiedSubmission({
    submit: submissionApi.submitEditProposal,
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

    const fields = [
      ...(dateChecked ? ["date"] : []),
      ...(descriptionChecked ? ["description"] : []),
      ...(peopleChecked ? ["people"] : []),
    ];
    if (fields.length === 0) {
      flow.setLocalError("Choose at least one field to edit.");
      return;
    }

    flow.begin(
      {
        original: {
          eventId: milestone.event_id,
          date: toIsoDate(milestone.date),
          description: milestone.event,
          people: parsePeople(milestone.people),
        },
        fields,
        requestedChange,
        ...(contributorName.trim()
          ? { contributorName: contributorName.trim() }
          : {}),
        ...(contributorEmail.trim()
          ? { contributorEmail: contributorEmail.trim() }
          : {}),
      },
      controllerRef.current,
    );
  }

  return (
    <form className="form" onSubmit={handleSubmit} aria-busy={flow.busy}>
      <h2 className="form-title" id="edit-milestone-title">
        Propose an edit
      </h2>

      {!submissionConfig.available && (
        <p className="form-alert" role="alert">
          {submissionConfig.message}
        </p>
      )}

      <fieldset className="form-fieldset form-field--checkbox-wrap">
        <legend className="form-label">What needs to be edited?</legend>
        <div className="form-field form-field--checkbox form-field--checkbox-full">
          <label className="checkbox-container">
            <span className="submit-wrap">
              <span className="submit-label">The date of the milestone:</span>
              <span className="submit-data">{milestone.date}</span>
            </span>
            <input
              type="checkbox"
              checked={dateChecked}
              onChange={(event) => setDateChecked(event.target.checked)}
            />
            <span className="checkmark" />
          </label>
        </div>
        <div className="form-field form-field--checkbox form-field--checkbox-full">
          <label className="checkbox-container">
            <span className="submit-wrap">
              <span className="submit-label">The people involved:</span>
              <span className="submit-data">{milestone.people}</span>
            </span>
            <input
              type="checkbox"
              checked={peopleChecked}
              onChange={(event) => setPeopleChecked(event.target.checked)}
            />
            <span className="checkmark" />
          </label>
        </div>
        <div className="form-field form-field--checkbox form-field--checkbox-full">
          <label className="checkbox-container">
            <span className="submit-wrap">
              <span className="submit-label">The description:</span>
              <span className="submit-data">{milestone.event}</span>
            </span>
            <input
              type="checkbox"
              checked={descriptionChecked}
              onChange={(event) => setDescriptionChecked(event.target.checked)}
            />
            <span className="checkmark" />
          </label>
        </div>
      </fieldset>

      <div className="form-field">
        <label className="form-label" htmlFor="requested-change">
          What should be updated?
        </label>
        <textarea
          id="requested-change"
          value={requestedChange}
          onChange={(event) => setRequestedChange(event.target.value)}
          required
          maxLength="1000"
        />
      </div>

      <div className="form-flex">
        <div className="form-field">
          <label className="form-label" htmlFor="edit-contributor-name">
            Your name
          </label>
          <input
            id="edit-contributor-name"
            value={contributorName}
            onChange={(event) => setContributorName(event.target.value)}
            type="text"
            maxLength="80"
            autoComplete="name"
          />
        </div>
        <div className="form-field">
          <label className="form-label" htmlFor="edit-contributor-email">
            Your email
          </label>
          <input
            id="edit-contributor-email"
            value={contributorEmail}
            onChange={(event) => setContributorEmail(event.target.value)}
            type="email"
            maxLength="254"
            autoComplete="email"
          />
        </div>
      </div>

      {submissionConfig.available && (
        <TurnstileWidget
          siteKey={submissionConfig.siteKey}
          action="edit_proposal"
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
          Verifying and sending your edit proposal…
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
        {flow.busy ? "Submitting…" : "Submit edit proposal"}
      </button>
    </form>
  );
}
