import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const script = join(process.cwd(), "scripts", "import-window-workbooks.py");

const candidates = [
  process.env.WINDOW_IMPORT_PYTHON,
  process.env.USERPROFILE
    ? join(
        process.env.USERPROFILE,
        ".cache",
        "codex-runtimes",
        "codex-primary-runtime",
        "dependencies",
        "python",
        "python.exe",
      )
    : undefined,
  "python3",
  "python",
].filter(Boolean);

let lastError = "";

for (const python of candidates) {
  if (python.includes("\\") && !existsSync(python)) {
    continue;
  }

  const result = spawnSync(python, [script, ...args], {
    cwd: process.cwd(),
    encoding: "utf-8",
    env: {
      ...process.env,
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
    },
    stdio: "inherit",
  });

  if (result.error) {
    lastError = result.error.message;
    continue;
  }

  process.exit(result.status ?? 0);
}

console.error(
  `Could not run Python importer. Set WINDOW_IMPORT_PYTHON to a Python executable with openpyxl installed. ${lastError}`,
);
process.exit(1);
