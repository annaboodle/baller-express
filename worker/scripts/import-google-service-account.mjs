import { createPrivateKey } from "node:crypto";
import {
  chmod,
  lstat,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WORKER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_PATH = resolve(WORKER_DIR, ".dev.vars");

function parseArguments(argv) {
  const values = new Map();

  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];

    if (!name?.startsWith("--") || typeof value !== "string") {
      throw new Error("Expected --input, --project, and --service-account values.");
    }

    values.set(name, value);
  }

  const inputPath = values.get("--input");
  const projectId = values.get("--project");
  const serviceAccountId = values.get("--service-account");

  if (!inputPath || !projectId || !serviceAccountId || values.size !== 3) {
    throw new Error("Expected --input, --project, and --service-account values.");
  }

  return { inputPath: resolve(inputPath), projectId, serviceAccountId };
}

function validateCredential(credential, { projectId, serviceAccountId }) {
  const expectedEmail = `${serviceAccountId}@${projectId}.iam.gserviceaccount.com`;
  const privateKey = credential?.private_key;

  if (
    credential?.type !== "service_account" ||
    credential?.project_id !== projectId ||
    credential?.client_email !== expectedEmail ||
    typeof credential?.private_key_id !== "string" ||
    credential.private_key_id.length === 0 ||
    typeof privateKey !== "string" ||
    !privateKey.startsWith("-----BEGIN PRIVATE KEY-----\n") ||
    !privateKey.endsWith("-----END PRIVATE KEY-----\n")
  ) {
    throw new Error("The key does not match the expected staging service account.");
  }

  createPrivateKey(privateKey);

  return {
    email: expectedEmail,
    escapedPrivateKey: privateKey.replace(/\r?\n/g, "\\n"),
  };
}

async function readCredential(inputPath) {
  const file = await lstat(inputPath);

  if (!file.isFile() || file.isSymbolicLink()) {
    throw new Error("The input must be a regular JSON file.");
  }

  return JSON.parse(await readFile(inputPath, "utf8"));
}

async function updateSecrets({ email, escapedPrivateKey }) {
  const output = await lstat(OUTPUT_PATH).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });

  if (output?.isSymbolicLink()) {
    throw new Error("Refusing to replace a symbolic-link secrets file.");
  }

  const current = output
    ? await readFile(OUTPUT_PATH, "utf8")
    : "# Staging-only values. This file is ignored by Git.\n";

  if (/^GOOGLE_(SERVICE_ACCOUNT_EMAIL|PRIVATE_KEY)=/m.test(current)) {
    throw new Error("Google credentials already exist; refusing to overwrite them.");
  }

  const prefix = current.endsWith("\n") ? current : `${current}\n`;
  const next =
    `${prefix}GOOGLE_SERVICE_ACCOUNT_EMAIL=${email}\n` +
    `GOOGLE_PRIVATE_KEY="${escapedPrivateKey}"\n`;
  const temporaryPath = `${OUTPUT_PATH}.tmp-${process.pid}-${Date.now()}`;

  try {
    await writeFile(temporaryPath, next, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporaryPath, OUTPUT_PATH);
    await chmod(OUTPUT_PATH, 0o600);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const credential = await readCredential(options.inputPath);
  const validated = validateCredential(credential, options);
  await updateSecrets(validated);
  process.stdout.write("Imported the validated key into the ignored local secrets file.\n");
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
