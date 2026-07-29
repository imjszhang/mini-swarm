/**
 * Spec table of contents from task pack — never from examples.json
 * (examples would leak the existence of a scoring suite).
 */
import { existsSync, readFileSync } from "node:fs";
import { getActiveTaskPack, loadPackSections } from "./task-pack.mjs";

export function listSpecSections() {
  const pack = getActiveTaskPack();
  const declared = loadPackSections(pack);
  if (!existsSync(pack.specTextPath)) return declared.slice();
  const text = readFileSync(pack.specTextPath, "utf8");
  const found = [];
  for (const name of declared) {
    if (text.includes(`## ${name}`)) found.push(name);
  }
  return found.length ? found : declared.slice();
}

export function formatSpecToc() {
  return listSpecSections().map((s) => `- ${s}`).join("\n");
}
