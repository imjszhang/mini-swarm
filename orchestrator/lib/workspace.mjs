/**
 * Workspace skeleton helpers shared by swarm entry (v13).
 * Intentionally duplicated from run.mjs so the legacy pipeline stays untouched.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { commitAll, initRepo } from "./git.mjs";
import { initGuideFolder } from "./guide.mjs";
import { npmExec } from "./win-exec.mjs";

function writeContentionStubs(workspaceDir) {
  mkdirSync(path.join(workspaceDir, "src", "blocks"), { recursive: true });
  mkdirSync(path.join(workspaceDir, "src", "inline"), { recursive: true });

  writeFileSync(path.join(workspaceDir, "src", "types.ts"), `export interface BlockNode {
  type: string;
  [k: string]: unknown;
}

export interface InlineNode {
  type: string;
  [k: string]: unknown;
}
`, "utf8");

  writeFileSync(path.join(workspaceDir, "src", "blocks", "registry.ts"), `import type { BlockNode } from "../types.js";

export type BlockParser = (
  lines: string[],
  pos: number,
) => { node: BlockNode; next: number } | null;

const parsers: BlockParser[] = [];

export function registerBlockParser(p: BlockParser): void {
  parsers.push(p);
}

export function getBlockParsers(): BlockParser[] {
  return parsers.slice();
}
`, "utf8");

  writeFileSync(path.join(workspaceDir, "src", "inline", "registry.ts"), `import type { InlineNode } from "../types.js";

export type InlineParser = (
  text: string,
  pos: number,
) => { node: InlineNode; next: number } | null;

const parsers: InlineParser[] = [];

export function registerInlineParser(p: InlineParser): void {
  parsers.push(p);
}

export function getInlineParsers(): InlineParser[] {
  return parsers.slice();
}
`, "utf8");

  writeFileSync(path.join(workspaceDir, "src", "render.ts"), `import type { BlockNode } from "./types.js";

export function renderNode(node: BlockNode): string {
  switch (node.type) {
    case "paragraph": {
      const text = typeof node.text === "string" ? node.text : "";
      return text ? "<p>" + text + "</p>\\n" : "";
    }
    default:
      return "";
  }
}
`, "utf8");

  writeFileSync(path.join(workspaceDir, "src", "index.ts"), `import { getBlockParsers } from "./blocks/registry.js";
import { renderNode } from "./render.js";
import type { BlockNode } from "./types.js";

function parseBlocks(input: string): BlockNode[] {
  const lines = input.replace(/\\r\\n/g, "\\n").split("\\n");
  const nodes: BlockNode[] = [];
  let pos = 0;
  const parsers = getBlockParsers();
  while (pos < lines.length) {
    let matched = false;
    for (const parser of parsers) {
      const result = parser(lines, pos);
      if (result) {
        nodes.push(result.node);
        pos = result.next;
        matched = true;
        break;
      }
    }
    if (!matched) {
      const text = lines[pos] ?? "";
      if (text.trim()) nodes.push({ type: "paragraph", text: text.trim() });
      pos += 1;
    }
  }
  return nodes;
}

export function renderMarkdown(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  return parseBlocks(input).map(renderNode).join("");
}
`, "utf8");

  writeFileSync(path.join(workspaceDir, "src", "contracts.ts"), `/**
 * Compile-checked design references.
 * Interface changes MUST update this file; tsc enforces consistency with DESIGN.md.
 */
export type { BlockNode, InlineNode } from "./types.js";
export type { BlockParser } from "./blocks/registry.js";
export type { InlineParser } from "./inline/registry.js";
export { registerBlockParser, getBlockParsers } from "./blocks/registry.js";
export { registerInlineParser, getInlineParsers } from "./inline/registry.js";
export { renderNode } from "./render.js";
`, "utf8");
}

export function initSwarmWorkspace(workspaceDir, { guideMaxLines = 80 } = {}) {
  rmSync(workspaceDir, { recursive: true, force: true });
  mkdirSync(workspaceDir, { recursive: true });
  initRepo(workspaceDir);
  writeFileSync(path.join(workspaceDir, "DESIGN.md"), "# Design\n\n(Planner will expand this.)\n", "utf8");
  initGuideFolder(workspaceDir, { maxLines: guideMaxLines });
  writeFileSync(path.join(workspaceDir, ".gitignore"), "node_modules/\ndist/\n", "utf8");
}

export function initSwarmSkeleton(workspaceDir, { mock = false } = {}) {
  mkdirSync(path.join(workspaceDir, "src"), { recursive: true });
  const pkg = {
    name: "mini-commonmark",
    type: "module",
    scripts: { build: "tsc" },
    devDependencies: { typescript: "^5.6.0", "@types/node": "^22.0.0" },
  };
  writeFileSync(path.join(workspaceDir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  writeFileSync(path.join(workspaceDir, "tsconfig.json"), `${JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      outDir: "dist",
      rootDir: "src",
      strict: true,
    },
    include: ["src/**/*"],
  }, null, 2)}\n`, "utf8");
  writeFileSync(path.join(workspaceDir, "src", "cli.ts"), `import { renderMarkdown } from "./index.js";
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => { input += c; });
process.stdin.on("end", () => { process.stdout.write(renderMarkdown(input)); });
`);
  writeContentionStubs(workspaceDir);

  if (mock) {
    npmExec(["install"], { cwd: workspaceDir, stdio: "ignore" });
    npmExec(["run", "build"], { cwd: workspaceDir, stdio: "ignore" });
    commitAll(workspaceDir, "mock skeleton");
  } else {
    commitAll(workspaceDir, "chore: skeleton");
  }
}
