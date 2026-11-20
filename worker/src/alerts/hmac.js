const encoder = new TextEncoder();

function toHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function requireSecret(secret) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("A strong internal alert secret is required.");
  }
  return secret;
}

function requireCrypto(cryptoImpl) {
  if (!cryptoImpl?.subtle) {
    throw new Error("Web Crypto is unavailable.");
  }
  return cryptoImpl;
}

export function canonicalInternalRequest({ timestamp, method, path, body }) {
  return `${timestamp}\n${method.toUpperCase()}\n${path}\n${body}`;
}

export async function signInternalRequest(
  secret,
  requestContext,
  cryptoImpl = globalThis.crypto,
) {
  const cryptoApi = requireCrypto(cryptoImpl);
  const key = await cryptoApi.subtle.importKey(
    "raw",
    encoder.encode(requireSecret(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await cryptoApi.subtle.sign(
    "HMAC",
    key,
    encoder.encode(canonicalInternalRequest(requestContext)),
  );
  return toHex(new Uint8Array(signature));
}

function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const length = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |=
      (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

export async function verifyInternalRequest({
  secret,
  timestamp,
  signature,
  method,
  path,
  body,
  nowSeconds,
  toleranceSeconds = 300,
  cryptoImpl = globalThis.crypto,
}) {
  const parsedTimestamp = Number(timestamp);
  if (
    !Number.isInteger(parsedTimestamp) ||
    Math.abs(nowSeconds - parsedTimestamp) > toleranceSeconds
  ) {
    return false;
  }
  if (!/^[a-f0-9]{64}$/i.test(signature || "")) return false;
  const expected = await signInternalRequest(
    secret,
    { timestamp: parsedTimestamp, method, path, body },
    cryptoImpl,
  );
  return constantTimeEqual(expected.toLowerCase(), signature.toLowerCase());
}
