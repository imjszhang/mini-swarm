#!/usr/bin/env node
/**
 * Smoke test: verify cursor-agent can create a file in a temp workspace.
 */
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { loadConfig, projectRoot } from "./lib/config.mjs";
import { spawnAgent } from "./runner.mjs";

const ROOT = projectRoot();
const runDir = path.join(ROOT, "runs", "smoke-runner");
const cwd = path.join(runDir, "workspace");
rmSync(runDir, { recursive: true, force: true });
mkdirSync(cwd, { recursive: true });

const config = loadConfig();
const prompt = "Create a file named hello.txt containing exactly: mini-swarm smoke ok. Then say SMOKE_DONE.";

console.log(`[smoke] model=${config.models.worker} cwd=${cwd}`);
const result = await spawnAgent({
  role: "worker",
  prompt,
  cwd,
  config,
  runDir,
  logKey: "smoke-worker",
  timeoutMs: 5 * 60 * 1000,
});

console.log(`[smoke] ok=${result.ok} elapsedMs=${result.elapsedMs} log=${result.logPath}`);
let ok = result.ok;
try {
  const text = readFileSync(path.join(cwd, "hello.txt"), "utf8").trim();
  console.log(`[smoke] hello.txt="${text}"`);
  ok = ok && text.includes("mini-swarm smoke ok");
} catch {
  console.error("[smoke] hello.txt not found");
  ok = false;
}

process.exit(ok ? 0 : 1);
