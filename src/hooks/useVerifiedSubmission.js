import { useEffect, useRef, useState } from "react";

import { createRequestId, SubmissionError } from "../submissions";

export default function useVerifiedSubmission({
  submit,
  onSuccess,
  onDuplicate,
}) {
  const [state, setState] = useState({ busy: false, error: "" });
  const mountedRef = useRef(true);
  const pendingRef = useRef(null);
  const retryRef = useRef(null);
  const phaseRef = useRef("idle");

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  function setSafeState(next) {
    if (mountedRef.current) setState(next);
  }

  function begin(payload, controller) {
    if (state.busy || phaseRef.current !== "idle") return;
    if (!controller) {
      setSafeState({
        busy: false,
        error: "Human verification is still loading. Please try again.",
      });
      return;
    }

    const fingerprint = JSON.stringify(payload);
    let requestId;
    try {
      requestId =
        retryRef.current?.fingerprint === fingerprint
          ? retryRef.current.requestId
          : createRequestId();
    } catch (error) {
      setSafeState({
        busy: false,
        error:
          error instanceof Error
            ? error.message
            : "A secure submission ID could not be created.",
      });
      return;
    }
    retryRef.current = { fingerprint, requestId };
    pendingRef.current = { payload, requestId };
    phaseRef.current = "challenge";
    setSafeState({ busy: true, error: "" });
    try {
      controller.execute();
    } catch {
      pendingRef.current = null;
      phaseRef.current = "idle";
      setSafeState({
        busy: false,
        error: "Human verification could not start. Please try again.",
      });
    }
  }

  async function acceptToken(token, controller) {
    const pending = pendingRef.current;
    if (phaseRef.current !== "challenge" || !pending || !token) return;
    pendingRef.current = null;
    phaseRef.current = "submit";
    try {
      const result = await submit({
        requestId: pending.requestId,
        turnstileToken: token,
        ...pending.payload,
      });
      controller?.reset();
      retryRef.current = null;
      phaseRef.current = "idle";
      setSafeState({ busy: false, error: "" });
      onSuccess(result);
    } catch (error) {
      controller?.reset();
      phaseRef.current = "idle";
      if (error?.code === "duplicate_submission") {
        retryRef.current = null;
        setSafeState({ busy: false, error: "" });
        onDuplicate();
        return;
      }
      if (!(error instanceof SubmissionError) || !error.retryable) {
        retryRef.current = null;
      }
      const waitMessage = error?.retryAfterSeconds
        ? ` Try again in about ${error.retryAfterSeconds} seconds.`
        : "";
      setSafeState({
        busy: false,
        error:
          (error instanceof Error
            ? error.message
            : "The submission could not be accepted.") + waitMessage,
      });
    }
  }

  function failChallenge(message, controller) {
    if (phaseRef.current === "submit") return;
    controller?.reset();
    pendingRef.current = null;
    phaseRef.current = "idle";
    setSafeState({ busy: false, error: message });
  }

  function setLocalError(error) {
    setSafeState({
      busy: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    busy: state.busy,
    error: state.error,
    begin,
    acceptToken,
    failChallenge,
    setLocalError,
  };
}
