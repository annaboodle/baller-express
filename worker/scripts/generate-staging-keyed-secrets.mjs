import { randomBytes } from "node:crypto";
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
const SECRET_NAMES = Object.freeze([
  "RATE_LIMIT_SECRET",
  "REQUEST_HASH_SECRET",
  "ALERT_POLL_SECRET",
]);
const SAFE_SECRET_PATTERN = /^[A-Za-z0-9_-]{32,}$/;
const PLACEHOLDER_PATTERN = /(replace|placeholder|change_me|example)/i;

function existingValue(source, name) {
  const assignments = source
    .split(/\r?\n/)
    .map((line) =>
      line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/),
    )
    .filter((match) => match?.[1] === name);

  if (assignments.length === 0) return null;
  if (assignments.length !== 1) {
    throw new Error(`${name} must be defined exactly once.`);
  }

  const rawValue = assignments[0][2].trim();
  if (!rawValue) {
    throw new Error(`${name} is present but empty.`);
  }

  const first = rawValue[0];
  const last = rawValue.at(-1);
  const startsQuoted = first === '"' || first === "'";
  const endsQuoted = last === '"' || last === "'";
  if (startsQuoted !== endsQuoted || (startsQuoted && first !== last)) {
    throw new Error(`${name} has mismatched quotes.`);
  }

  const value = startsQuoted ? rawValue.slice(1, -1) : rawValue;
  if (!SAFE_SECRET_PATTERN.test(value) || PLACEHOLDER_PATTERN.test(value)) {
    throw new Error(
      `${name} must be at least 32 base64url characters and not a placeholder.`,
    );
  }
  return value;
}

export async function generateStagingKeyedSecrets(
  outputPath = OUTPUT_PATH,
  createValue = () => randomBytes(32).toString("base64url"),
) {
  const file = await lstat(outputPath);
  if (!file.isFile() || file.isSymbolicLink()) {
    throw new Error("The local secrets target must be a regular file.");
  }

  const current = await readFile(outputPath, "utf8");
  const generated = [];
  const values = new Map();

  for (const name of SECRET_NAMES) {
    const value = existingValue(current, name);
    const nextValue = value || createValue(name);
    if (!SAFE_SECRET_PATTERN.test(nextValue) || PLACEHOLDER_PATTERN.test(nextValue)) {
      throw new Error(
        `${name} must be at least 32 base64url characters and not a placeholder.`,
      );
    }
    values.set(name, nextValue);
    if (value === null) generated.push(name);
  }

  if (new Set(values.values()).size !== SECRET_NAMES.length) {
    throw new Error("The keyed staging secrets must be independent.");
  }

  if (generated.length === 0) {
    return generated;
  }

  const prefix = current.endsWith("\n") ? current : `${current}\n`;
  const additions = generated
    .map((name) => `${name}=${values.get(name)}`)
    .join("\n");
  const temporaryPath = `${outputPath}.tmp-${process.pid}-${Date.now()}`;

  try {
    await writeFile(temporaryPath, `${prefix}${additions}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, outputPath);
    await chmod(outputPath, 0o600);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }

  return generated;
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  generateStagingKeyedSecrets()
    .then((generated) => {
      process.stdout.write(
        generated.length === 0
          ? "All keyed staging secrets are already configured.\n"
          : `Generated ${generated.join(", ")} without displaying their values.\n`,
      );
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
