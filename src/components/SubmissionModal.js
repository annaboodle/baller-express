import React, { useEffect, useRef } from "react";

import CloseIcon from "./icons/CloseIcon.js";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export default function SubmissionModal({
  open,
  onClose,
  busy = false,
  titleId,
  className = "",
  wrapperClassName = "",
  closeLabel = "Close dialog",
  returnFocusRef,
  children,
}) {
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(null);
  const busyRef = useRef(busy);
  const onCloseRef = useRef(onClose);

  busyRef.current = busy;
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;

    previousFocusRef.current = returnFocusRef?.current || document.activeElement;
    if (dialogRef.current) dialogRef.current.focus();

    function handleKeyDown(event) {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        onCloseRef.current();
      }

      if (event.key === "Tab" && dialogRef.current) {
        const dialog = dialogRef.current;
        const focusable = Array.from(
          dialog.querySelectorAll(FOCUSABLE_SELECTOR),
        );

        if (focusable.length === 0) {
          event.preventDefault();
          dialog.focus();
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        const focusIsOutside = !dialog.contains(active);

        if (
          event.shiftKey &&
          (active === first || active === dialog || focusIsOutside)
        ) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          (active === last || active === dialog || focusIsOutside)
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      const returnTarget = previousFocusRef.current;
      if (returnTarget && typeof returnTarget.focus === "function") {
        returnTarget.focus();
      }
    };
  }, [open, returnFocusRef]);

  if (!open) return null;

  function requestClose() {
    if (!busy) onClose();
  }

  return (
    <div className={`modal-wrap modal-open ${wrapperClassName}`.trim()}>
      <div
        className="modal-bg"
        aria-hidden="true"
        data-testid="submission-modal-backdrop"
        onClick={requestClose}
      />
      <div
        ref={dialogRef}
        className={`modal ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy ? "true" : undefined}
        tabIndex="-1"
      >
        <button
          type="button"
          className="modal-close"
          aria-label={closeLabel}
          disabled={busy}
          onClick={requestClose}
        >
          <CloseIcon />
        </button>
        {children}
      </div>
    </div>
  );
}
