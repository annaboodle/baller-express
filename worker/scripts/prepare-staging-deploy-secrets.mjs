import { chmod, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WORKER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SOURCE = resolve(WORKER_DIR, ".dev.vars");
const DEFAULT_OUTPUT = resolve(
  WORKER_DIR,
  "local-secrets/staging-deploy.env",
);

export const REQUIRED_STAGING_SECRETS = Object.freeze([
  "TURNSTILE_SECRET_KEY",
  "RATE_LIMIT_SECRET",
  "REQUEST_HASH_SECRET",
  "ALERT_POLL_SECRET",
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_PRIVATE_KEY",
  "GOOGLE_SHEETS_SPREADSHEET_ID",
]);

export async function prepareStagingDeploySecrets(
  sourcePath = DEFAULT_SOURCE,
  outputPath = DEFAULT_OUTPUT,
) {
  const sourceFile = await lstat(sourcePath);
  if (!sourceFile.isFile() || sourceFile.isSymbolicLink()) {
    throw new Error("The local secrets source must be a regular file.");
  }

  const source = await readFile(sourcePath, "utf8");
  const assignments = new Map();
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/,
    );
    if (!match || !REQUIRED_STAGING_SECRETS.includes(match[1])) continue;
    const name = match[1];
    if (assignments.has(name)) {
      throw new Error(`${name} must be defined exactly once.`);
    }
    if (!match[2].trim()) {
      throw new Error(`${name} is present but empty.`);
    }
    assignments.set(name, `${name}=${match[2]}`);
  }

  const missing = REQUIRED_STAGING_SECRETS.filter(
    (name) => !assignments.has(name),
  );
  if (missing.length > 0) {
    throw new Error(`Missing required staging secrets: ${missing.join(", ")}`);
  }

  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
  const contents = `${REQUIRED_STAGING_SECRETS.map((name) =>
    assignments.get(name),
  ).join("\n")}\n`;
  await writeFile(outputPath, contents, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  await chmod(outputPath, 0o600);
  return outputPath;
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  prepareStagingDeploySecrets()
    .then((outputPath) => {
      process.stdout.write(
        `Prepared ${REQUIRED_STAGING_SECRETS.length} required staging secrets at ${outputPath} without displaying their values.\n`,
      );
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
