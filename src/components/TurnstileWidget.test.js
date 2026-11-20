import React from "react";
import { act, render, wait } from "@testing-library/react";

import TurnstileWidget, {
  resetTurnstileLoaderForTests,
} from "./TurnstileWidget";

function callbacks(overrides = {}) {
  return {
    onReady: jest.fn(),
    onToken: jest.fn(),
    onFailure: jest.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  resetTurnstileLoaderForTests();
  delete window.turnstile;
  document
    .querySelectorAll("script[data-baller-turnstile]")
    .forEach((script) => script.remove());
});

test("loads only the official explicit-render script", () => {
  const props = callbacks();
  const { unmount } = render(
    <TurnstileWidget
      siteKey="public-key"
      action="add_milestone"
      {...props}
    />,
  );

  const script = document.querySelector("script[data-baller-turnstile]");
  expect(script).not.toBeNull();
  expect(script.src).toBe(
    "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
  );
  unmount();
});

test("renders explicit execute mode, exposes a controller, and removes on unmount", async () => {
  let renderOptions;
  window.turnstile = {
    render: jest.fn((_element, options) => {
      renderOptions = options;
      return "widget-1";
    }),
    execute: jest.fn(),
    reset: jest.fn(),
    remove: jest.fn(),
  };
  const props = callbacks();
  const { container, unmount } = render(
    <TurnstileWidget
      siteKey="public-key"
      action="edit_proposal"
      {...props}
    />,
  );

  await wait(() => expect(props.onReady).toHaveBeenCalled());
  expect(window.turnstile.render).toHaveBeenCalledTimes(1);
  expect(renderOptions).toEqual(
    expect.objectContaining({
      sitekey: "public-key",
      action: "edit_proposal",
      execution: "execute",
      appearance: "interaction-only",
      size: "flexible",
    }),
  );

  const controller = props.onReady.mock.calls[0][0];
  controller.execute();
  controller.reset();
  expect(window.turnstile.execute).toHaveBeenCalledWith("widget-1");
  expect(window.turnstile.reset).toHaveBeenCalledWith("widget-1");

  act(() => renderOptions.callback("secret-token-value"));
  expect(props.onToken).toHaveBeenCalledWith("secret-token-value");
  expect(container).not.toHaveTextContent("secret-token-value");

  unmount();
  expect(window.turnstile.remove).toHaveBeenCalledWith("widget-1");
  expect(props.onReady).toHaveBeenLastCalledWith(null);
});

test("converts widget failures, expiry, and timeout into safe retry messages", async () => {
  let renderOptions;
  window.turnstile = {
    render: jest.fn((_element, options) => {
      renderOptions = options;
      return "widget-2";
    }),
    execute: jest.fn(),
    reset: jest.fn(),
    remove: jest.fn(),
  };
  const props = callbacks();
  render(
    <TurnstileWidget
      siteKey="public-key"
      action="add_milestone"
      {...props}
    />,
  );
  await wait(() => expect(props.onReady).toHaveBeenCalled());

  act(() => renderOptions["error-callback"]("private-error-code"));
  act(() => renderOptions["expired-callback"]());
  act(() => renderOptions["timeout-callback"]());

  expect(props.onFailure.mock.calls.map(([message]) => message)).toEqual([
    "Human verification could not start. Please try again.",
    "Human verification expired. Please try again.",
    "Human verification timed out. Please try again.",
  ]);
});

test("removes an unusable loader so a later mount can retry", async () => {
  const first = callbacks();
  const { unmount } = render(
    <TurnstileWidget
      siteKey="public-key"
      action="add_milestone"
      {...first}
    />,
  );
  const failedScript = document.querySelector("script[data-baller-turnstile]");

  act(() => {
    failedScript.dispatchEvent(new Event("load"));
  });
  await wait(() => expect(first.onFailure).toHaveBeenCalled());
  expect(failedScript).not.toBeInTheDocument();
  unmount();

  const second = callbacks();
  render(
    <TurnstileWidget
      siteKey="public-key"
      action="add_milestone"
      {...second}
    />,
  );
  expect(document.querySelector("script[data-baller-turnstile]")).not.toBe(
    failedScript,
  );
});
