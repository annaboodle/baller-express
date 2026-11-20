const textEncoder = new TextEncoder();

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function requireCrypto(cryptoImpl) {
  if (!cryptoImpl?.subtle) {
    throw new Error("Web Crypto is unavailable.");
  }
  return cryptoImpl;
}

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
  return `{${entries.join(",")}}`;
}

export async function hmacSha256Hex(
  secret,
  value,
  cryptoImpl = globalThis.crypto,
) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("A strong keyed-hash secret is required.");
  }
  const webCrypto = requireCrypto(cryptoImpl);
  const key = await webCrypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await webCrypto.subtle.sign(
    "HMAC",
    key,
    textEncoder.encode(value),
  );
  return bytesToHex(new Uint8Array(signature));
}
