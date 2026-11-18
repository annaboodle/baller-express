import { createServer } from "node:http";
import { lstat, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WORKER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DEV_VARS = resolve(WORKER_DIR, ".dev.vars");
const STATIC_DIR = resolve(WORKER_DIR, "staging-smoke");
const LISTEN_HOST = "127.0.0.1";
const LISTEN_PORT = 3000;
const ALLOWED_HOST = "localhost:3000";

const STATIC_FILES = Object.freeze({
  "/": Object.freeze({ name: "index.html", type: "text/html; charset=utf-8" }),
  "/app.js": Object.freeze({
    name: "app.js",
    type: "text/javascript; charset=utf-8",
  }),
  "/styles.css": Object.freeze({ name: "styles.css", type: "text/css; charset=utf-8" }),
});

function decodeAssignment(raw) {
  const value = raw.trim();
  if (value.startsWith('"')) {
    const decoded = JSON.parse(value);
    if (typeof decoded !== "string") throw new Error("Invalid quoted value.");
    return decoded;
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}

export function normalizeWorkerOrigin(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("--worker-origin is required.");
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("--worker-origin must be a valid HTTPS origin.");
  }
  const isWorkersDev =
    url.hostname !== "workers.dev" && url.hostname.endsWith(".workers.dev");
  if (
    url.protocol !== "https:" ||
    !isWorkersDev ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "--worker-origin must be a path-free https://*.workers.dev staging origin.",
    );
  }
  return url.origin;
}

export function parseArguments(argv) {
  let workerOrigin;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--worker-origin") {
      if (workerOrigin !== undefined || index + 1 >= argv.length) {
        throw new Error("--worker-origin must be provided exactly once.");
      }
      workerOrigin = argv[index + 1];
      index += 1;
      continue;
    }
    if (argument.startsWith("--worker-origin=")) {
      if (workerOrigin !== undefined) {
        throw new Error("--worker-origin must be provided exactly once.");
      }
      workerOrigin = argument.slice("--worker-origin=".length);
      continue;
    }
    throw new Error(`Unsupported argument: ${argument}`);
  }
  return Object.freeze({ workerOrigin: normalizeWorkerOrigin(workerOrigin) });
}

export async function readTurnstileSiteKey(path = DEFAULT_DEV_VARS) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("The local variables source must be a regular file.");
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error("The local variables source must be owner-readable only.");
  }

  const source = await readFile(path, "utf8");
  const values = [];
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(
      /^\s*(?:export\s+)?TURNSTILE_SITE_KEY\s*=(.*)$/,
    );
    if (match) values.push(decodeAssignment(match[1]));
  }
  if (values.length !== 1 || !/^[A-Za-z0-9_-]{8,200}$/.test(values[0])) {
    throw new Error(
      "TURNSTILE_SITE_KEY must be defined exactly once in the ignored local variables file.",
    );
  }
  return values[0];
}

function securityHeaders(workerOrigin) {
  return {
    "cache-control": "no-store",
    "content-security-policy": [
      "default-src 'self'",
      "base-uri 'none'",
      `connect-src 'self' ${workerOrigin} https://challenges.cloudflare.com`,
      "font-src 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
      "frame-src https://challenges.cloudflare.com",
      "img-src 'none'",
      "script-src 'self' https://challenges.cloudflare.com",
      "style-src 'self'",
    ].join("; "),
    "permissions-policy":
      "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  };
}

function send(response, status, type, body, headers) {
  response.writeHead(status, {
    ...headers,
    "content-type": type,
  });
  response.end(body);
}

export function createSmokeHarnessServer({
  workerOrigin,
  turnstileSiteKey,
  staticDirectory = STATIC_DIR,
  allowedHost = ALLOWED_HOST,
}) {
  const normalizedOrigin = normalizeWorkerOrigin(workerOrigin);
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(turnstileSiteKey || "")) {
    throw new Error("A valid Turnstile site key is required.");
  }
  const headers = securityHeaders(normalizedOrigin);

  return createServer(async (request, response) => {
    try {
      if (request.headers.host !== allowedHost) {
        send(response, 421, "text/plain; charset=utf-8", "Misdirected request.\n", headers);
        return;
      }
      if (request.method !== "GET") {
        send(response, 405, "text/plain; charset=utf-8", "Method not allowed.\n", {
          ...headers,
          allow: "GET",
        });
        return;
      }
      const requestUrl = new URL(request.url || "/", "http://localhost");
      if (requestUrl.pathname === "/config.json" && !requestUrl.search) {
        send(
          response,
          200,
          "application/json; charset=utf-8",
          JSON.stringify({
            workerOrigin: normalizedOrigin,
            turnstileSiteKey,
          }),
          headers,
        );
        return;
      }
      const file = !requestUrl.search ? STATIC_FILES[requestUrl.pathname] : undefined;
      if (!file) {
        send(response, 404, "text/plain; charset=utf-8", "Not found.\n", headers);
        return;
      }
      const body = await readFile(resolve(staticDirectory, file.name));
      send(response, 200, file.type, body, headers);
    } catch {
      send(
        response,
        500,
        "text/plain; charset=utf-8",
        "The local staging harness could not serve this request.\n",
        headers,
      );
    }
  });
}

export async function startStagingSmokeHarness({ workerOrigin }) {
  const turnstileSiteKey = await readTurnstileSiteKey();
  const server = createSmokeHarnessServer({ workerOrigin, turnstileSiteKey });
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(LISTEN_PORT, LISTEN_HOST, resolvePromise);
  });
  process.stdout.write(
    "Staging smoke harness ready at http://localhost:3000. No token or key is logged.\n",
  );
  return server;
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  let server;
  try {
    const options = parseArguments(process.argv.slice(2));
    server = await startStagingSmokeHarness(options);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }

  if (server) {
    const stop = () => server.close(() => process.exit(0));
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  }
}
