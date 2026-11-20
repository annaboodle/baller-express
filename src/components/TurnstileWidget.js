import React, { useEffect, useRef } from "react";

const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let loaderPromise;

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(
      `script[src="${TURNSTILE_SCRIPT_URL}"]`,
    );
    const script = existing || document.createElement("script");

    function handleLoad() {
      if (window.turnstile) {
        resolve(window.turnstile);
        return;
      }
      loaderPromise = undefined;
      script.remove();
      reject(new Error("Turnstile did not initialize."));
    }
    function handleError() {
      loaderPromise = undefined;
      script.remove();
      reject(new Error("Turnstile could not be loaded."));
    }

    script.addEventListener("load", handleLoad, { once: true });
    script.addEventListener("error", handleError, { once: true });
    if (!existing) {
      script.src = TURNSTILE_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.dataset.ballerTurnstile = "true";
      document.head.appendChild(script);
    }
  });

  return loaderPromise;
}

export default function TurnstileWidget({
  siteKey,
  action,
  onToken,
  onFailure,
  onReady,
}) {
  const containerRef = useRef(null);
  const callbacksRef = useRef({ onToken, onFailure, onReady });
  callbacksRef.current = { onToken, onFailure, onReady };

  useEffect(() => {
    let widgetId;
    let disposed = false;
    let turnstileApi;

    loadTurnstile()
      .then((turnstile) => {
        if (disposed || !containerRef.current) return;
        turnstileApi = turnstile;
        widgetId = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          action,
          execution: "execute",
          appearance: "interaction-only",
          size: "flexible",
          callback(token) {
            callbacksRef.current.onToken(token);
          },
          "error-callback"() {
            callbacksRef.current.onFailure(
              "Human verification could not start. Please try again.",
            );
          },
          "expired-callback"() {
            callbacksRef.current.onFailure(
              "Human verification expired. Please try again.",
            );
          },
          "timeout-callback"() {
            callbacksRef.current.onFailure(
              "Human verification timed out. Please try again.",
            );
          },
        });

        callbacksRef.current.onReady(
          Object.freeze({
            execute() {
              turnstile.execute(widgetId);
            },
            reset() {
              turnstile.reset(widgetId);
            },
          }),
        );
      })
      .catch(() => {
        if (!disposed) {
          callbacksRef.current.onFailure(
            "Human verification is unavailable. Please try again.",
          );
        }
      });

    return () => {
      disposed = true;
      callbacksRef.current.onReady(null);
      if (
        turnstileApi &&
        widgetId !== undefined &&
        typeof turnstileApi.remove === "function"
      ) {
        turnstileApi.remove(widgetId);
      }
    };
  }, [action, siteKey]);

  return (
    <div
      ref={containerRef}
      className="turnstile-widget"
      aria-label="Human verification"
    />
  );
}

export function resetTurnstileLoaderForTests() {
  loaderPromise = undefined;
}
