import { execFileSync } from "node:child_process";
import { readConfig } from "../src/config.mjs";

// Inspect staged bytes without printing credentials or file contents.
const { key } = readConfig();
const files = execFileSync("git", ["diff", "--cached", "--name-only", "-z"])
  .toString("utf8")
  .split("\0")
  .filter(Boolean);
for (const file of files) {
  if (
    (file.startsWith(".env") && file !== ".env.example") ||
    /^(\.liveworld|captures|node_modules)\//.test(file)
  )
    throw new Error(`Private path was staged: ${file}`);
  const data = execFileSync("git", ["show", `:${file}`], {
    maxBuffer: 10_000_000,
  });
  if (key.length > 8 && data.includes(Buffer.from(key)))
    throw new Error(`A credential was detected in staged file: ${file}`);
}
console.log(
  JSON.stringify({
    stagedFilesChecked: files.length,
    privateFilesStaged: false,
    credentialDetected: false,
    localKeyAvailableForComparison: Boolean(key),
  }),
);
