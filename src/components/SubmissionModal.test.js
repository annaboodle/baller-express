import React, { createRef } from "react";
import { fireEvent, render } from "@testing-library/react";

import SubmissionModal from "./SubmissionModal";

function ModalFixture({ open = true, busy = false, onClose = jest.fn() }) {
  return (
    <SubmissionModal
      open={open}
      busy={busy}
      onClose={onClose}
      titleId="submission-title"
    >
      <h2 id="submission-title">Submit a milestone</h2>
    </SubmissionModal>
  );
}

test("does not leave a closed submission form in the DOM", () => {
  const { queryByRole } = render(<ModalFixture open={false} />);

  expect(queryByRole("dialog")).toBeNull();
});

test("labels and focuses the open dialog", () => {
  const { getByRole } = render(<ModalFixture />);
  const dialog = getByRole("dialog");

  expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(dialog).toHaveAttribute("aria-labelledby", "submission-title");
  expect(dialog).toHaveFocus();
});

test("closes from the button, backdrop, and Escape key", () => {
  const onClose = jest.fn();
  const { getByLabelText, getByTestId } = render(
    <ModalFixture onClose={onClose} />,
  );

  fireEvent.click(getByLabelText("Close dialog"));
  fireEvent.click(getByTestId("submission-modal-backdrop"));
  fireEvent.keyDown(document, { key: "Escape" });

  expect(onClose).toHaveBeenCalledTimes(3);
});

test("blocks dismissal while a submission is in progress", () => {
  const onClose = jest.fn();
  const { getByLabelText, getByRole, getByTestId } = render(
    <ModalFixture busy onClose={onClose} />,
  );

  expect(getByRole("dialog")).toHaveAttribute("aria-busy", "true");
  expect(getByLabelText("Close dialog")).toBeDisabled();

  fireEvent.click(getByLabelText("Close dialog"));
  fireEvent.click(getByTestId("submission-modal-backdrop"));
  fireEvent.keyDown(document, { key: "Escape" });

  expect(onClose).not.toHaveBeenCalled();
});

test("returns focus to the opening control when the dialog unmounts", () => {
  const returnFocusRef = createRef();
  const onClose = jest.fn();
  const { getByRole, rerender } = render(
    <>
      <button ref={returnFocusRef}>Open submissions</button>
      <SubmissionModal
        open
        onClose={onClose}
        titleId="focus-title"
        returnFocusRef={returnFocusRef}
      >
        <h2 id="focus-title">Submission form</h2>
      </SubmissionModal>
    </>,
  );

  expect(getByRole("dialog")).toHaveFocus();

  rerender(
    <>
      <button ref={returnFocusRef}>Open submissions</button>
      <SubmissionModal
        open={false}
        onClose={onClose}
        titleId="focus-title"
        returnFocusRef={returnFocusRef}
      >
        <h2 id="focus-title">Submission form</h2>
      </SubmissionModal>
    </>,
  );

  expect(returnFocusRef.current).toHaveFocus();
});

test("wraps Tab from the final control to the first control", () => {
  const { getByLabelText, getByText } = render(
    <SubmissionModal open onClose={jest.fn()} titleId="tab-title">
      <h2 id="tab-title">Submission form</h2>
      <button type="button">First form control</button>
      <button type="button">Final form control</button>
    </SubmissionModal>,
  );

  getByText("Final form control").focus();
  fireEvent.keyDown(document, { key: "Tab" });

  expect(getByLabelText("Close dialog")).toHaveFocus();
});

test("wraps Shift+Tab from the first control to the final control", () => {
  const { getByLabelText, getByText } = render(
    <SubmissionModal open onClose={jest.fn()} titleId="shift-tab-title">
      <h2 id="shift-tab-title">Submission form</h2>
      <button type="button">First form control</button>
      <button type="button">Final form control</button>
    </SubmissionModal>,
  );

  getByLabelText("Close dialog").focus();
  fireEvent.keyDown(document, { key: "Tab", shiftKey: true });

  expect(getByText("Final form control")).toHaveFocus();
});
