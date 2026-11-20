import React from "react";
import { act, render } from "@testing-library/react";

import useVerifiedSubmission from "./useVerifiedSubmission";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function renderSubmissionHook(options) {
  let current;

  function Harness() {
    current = useVerifiedSubmission(options);
    return null;
  }

  render(<Harness />);
  return { get current() { return current; } };
}

beforeEach(() => {
  Object.defineProperty(window, "crypto", {
    configurable: true,
    value: {
      randomUUID: jest.fn(() => "00000000-0000-4000-8000-000000000001"),
    },
  });
});

test("consumes a pending verification before awaiting the submission", async () => {
  const request = deferred();
  const submit = jest.fn(() => request.promise);
  const onSuccess = jest.fn();
  const hook = renderSubmissionHook({
    submit,
    onSuccess,
    onDuplicate: jest.fn(),
  });
  const controller = { execute: jest.fn(), reset: jest.fn() };

  act(() => {
    hook.current.begin({ description: "A milestone" }, controller);
  });

  let firstCallback;
  let repeatedCallback;
  act(() => {
    firstCallback = hook.current.acceptToken("first-token", controller);
    repeatedCallback = hook.current.acceptToken("repeated-token", controller);
  });

  expect(submit).toHaveBeenCalledTimes(1);
  expect(submit).toHaveBeenCalledWith({
    requestId: "00000000-0000-4000-8000-000000000001",
    turnstileToken: "first-token",
    description: "A milestone",
  });

  await act(async () => {
    request.resolve({ ok: true, submissionId: "submission-1" });
    await Promise.all([firstCallback, repeatedCallback]);
  });

  expect(onSuccess).toHaveBeenCalledTimes(1);
  expect(controller.reset).toHaveBeenCalledTimes(1);
});

test("ignores a late token after verification execution throws", async () => {
  const submit = jest.fn();
  const hook = renderSubmissionHook({
    submit,
    onSuccess: jest.fn(),
    onDuplicate: jest.fn(),
  });
  const controller = {
    execute: jest.fn(() => {
      throw new Error("private Turnstile detail");
    }),
    reset: jest.fn(),
  };

  act(() => {
    hook.current.begin({ description: "A milestone" }, controller);
  });

  expect(hook.current.busy).toBe(false);
  expect(hook.current.error).toBe(
    "Human verification could not start. Please try again.",
  );

  await act(async () => {
    await hook.current.acceptToken("late-token", controller);
  });

  expect(submit).not.toHaveBeenCalled();
});

test("ignores a second begin while a submission is active", async () => {
  const request = deferred();
  const submit = jest.fn(() => request.promise);
  const hook = renderSubmissionHook({
    submit,
    onSuccess: jest.fn(),
    onDuplicate: jest.fn(),
  });
  const controller = { execute: jest.fn(), reset: jest.fn() };

  act(() => {
    hook.current.begin({ description: "First milestone" }, controller);
    hook.current.begin({ description: "Second milestone" }, controller);
  });

  expect(controller.execute).toHaveBeenCalledTimes(1);
  let submission;
  act(() => {
    submission = hook.current.acceptToken("first-token", controller);
    hook.current.begin({ description: "Third milestone" }, controller);
  });
  expect(controller.execute).toHaveBeenCalledTimes(1);
  expect(submit).toHaveBeenCalledTimes(1);

  await act(async () => {
    request.resolve({ ok: true, submissionId: "submission-1" });
    await submission;
  });
});
