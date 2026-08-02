import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { projectRoot } from "./config.mjs";

/**
 * Load project-root `.env` into process.env (does not override existing vars).
 * Used so cursor-agent picks up CURSOR_API_KEY without interactive login.
 */
export function loadEnvFile() {
  const envPath = path.join(projectRoot(), ".env");
  if (!existsSync(envPath)) return;

  const content = readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile();
