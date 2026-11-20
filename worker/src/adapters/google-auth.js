import {
  UPSTREAM_FAILURE_CATEGORIES,
  UpstreamDependencyError,
} from "./upstream-error.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const DEFAULT_TIMEOUT_MS = 8_000;
const encoder = new TextEncoder();

function unavailable() {
  return new UpstreamDependencyError(
    UPSTREAM_FAILURE_CATEGORIES.googleAuth,
    "Google authentication was unavailable.",
  );
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlText(value) {
  return base64Url(encoder.encode(value));
}

function privateKeyBytes(pem) {
  const normalized = pem.replace(/\\n/g, "\n");
  const body = normalized
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  if (body.length === 0) throw new Error("The Google private key is invalid.");
  const binary = atob(body);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function signJwt({ email, privateKey, issuedAt, cryptoImpl }) {
  if (!cryptoImpl?.subtle) throw new Error("Web Crypto is unavailable.");
  const header = base64UrlText(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64UrlText(
    JSON.stringify({
      iss: email,
      scope: SHEETS_SCOPE,
      aud: TOKEN_URL,
      iat: issuedAt,
      exp: issuedAt + 3600,
    }),
  );
  const unsigned = `${header}.${claims}`;
  const key = await cryptoImpl.subtle.importKey(
    "pkcs8",
    privateKeyBytes(privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await cryptoImpl.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(unsigned),
  );
  return `${unsigned}.${base64Url(new Uint8Array(signature))}`;
}

export function createGoogleAccessTokenProvider({
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  cryptoImpl = globalThis.crypto,
  signer = signJwt,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required.");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("The Google authentication timeout must be positive.");
  }
  let cache = null;

  return Object.freeze({
    async getToken(env) {
      const email = env?.GOOGLE_SERVICE_ACCOUNT_EMAIL;
      const privateKey = env?.GOOGLE_PRIVATE_KEY;
      if (typeof email !== "string" || !email.includes("@")) {
        throw unavailable();
      }
      if (typeof privateKey !== "string" || privateKey.length === 0) {
        throw unavailable();
      }

      const nowMs = now();
      if (
        cache?.email === email &&
        cache.expiresAtMs - nowMs > 60_000
      ) {
        return cache.token;
      }

      let assertion;
      try {
        assertion = await signer({
          email,
          privateKey,
          issuedAt: Math.floor(nowMs / 1000),
          cryptoImpl,
        });
      } catch {
        throw unavailable();
      }
      const form = new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let result;
      try {
        const response = await fetchImpl(TOKEN_URL, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: form,
          signal: controller.signal,
        });
        if (!response.ok) {
          throw unavailable();
        }
        result = await response.json();
      } catch (error) {
        if (error instanceof UpstreamDependencyError) {
          throw error;
        }
        throw unavailable();
      } finally {
        clearTimeout(timer);
      }
      if (
        typeof result?.access_token !== "string" ||
        !Number.isFinite(Number(result?.expires_in))
      ) {
        throw unavailable();
      }
      cache = {
        email,
        token: result.access_token,
        expiresAtMs: nowMs + Number(result.expires_in) * 1000,
      };
      return cache.token;
    },
  });
}
