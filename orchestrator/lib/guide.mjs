/**
 * Field Guide folder (S-A-008): guide/index.md inject + line budget.
 * Legacy GUIDE.md is still read as a fallback for v8–v12 workspaces.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export function initGuideFolder(workspaceDir, { maxLines = 80 } = {}) {
  const dir = path.join(workspaceDir, "guide");
  mkdirSync(dir, { recursive: true });
  const index = path.join(dir, "index.md");
  if (!existsSync(index)) {
    writeFileSync(
      index,
      [
        "# Field Guide",
        "",
        `Line budget for this index: keep under ~${maxLines} lines.`,
        "Workers append short, surprising, reusable findings below.",
        "Do not paste long code dumps here — link to files instead.",
        "",
        "## Findings",
        "",
      ].join("\n"),
      "utf8",
    );
  }
  // Keep a stub GUIDE.md pointing at the folder for older readers.
  const legacy = path.join(workspaceDir, "GUIDE.md");
  if (!existsSync(legacy)) {
    writeFileSync(legacy, "# Field Guide\n\nSee `guide/index.md`.\n", "utf8");
  }
}

export function readGuideIndex(workspaceDir, { maxLines = 80 } = {}) {
  const index = path.join(workspaceDir, "guide", "index.md");
  let text = "";
  if (existsSync(index)) text = readFileSync(index, "utf8");
  else {
    const legacy = path.join(workspaceDir, "GUIDE.md");
    if (existsSync(legacy)) text = readFileSync(legacy, "utf8");
  }
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return `${lines.slice(0, maxLines).join("\n")}\n\n_(truncated: showing first ${maxLines} lines)_\n`;
}

export function appendGuideNote(workspaceDir, note) {
  if (!note || !String(note).trim()) return false;
  const dir = path.join(workspaceDir, "guide");
  mkdirSync(dir, { recursive: true });
  const index = path.join(dir, "index.md");
  const stamp = new Date().toISOString().slice(0, 19);
  const block = `\n- (${stamp}) ${String(note).trim().replace(/\s+/g, " ").slice(0, 400)}\n`;
  if (existsSync(index)) {
    writeFileSync(index, readFileSync(index, "utf8") + block, "utf8");
  } else {
    initGuideFolder(workspaceDir);
    writeFileSync(index, readFileSync(index, "utf8") + block, "utf8");
  }
  return true;
}
