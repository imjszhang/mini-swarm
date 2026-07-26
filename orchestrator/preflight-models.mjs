#!/usr/bin/env node
/**
 * Probe each unique model slug in config.json via cursor-agent.
 * Does NOT silently remap failed slugs — report and exit non-zero.
 */
import { loadConfig, listConfiguredModels, projectRoot } from "./lib/config.mjs";
import { spawnAgent } from "./runner.mjs";
import path from "node:path";
import { mkdirSync } from "node:fs";

const config = loadConfig();
const models = listConfiguredModels(config);
const runDir = path.join(projectRoot(), "runs", "_preflight-models");
mkdirSync(path.join(runDir, "logs"), { recursive: true });

console.log(`[preflight:models] probing ${models.length} slug(s): ${models.join(", ")}`);

const failures = [];
for (const slug of models) {
  const probeConfig = {
    ...config,
    models: { ...config.models, worker: slug },
    agentCommand: config.agentCommand,
  };
  const started = Date.now();
  console.log(`[preflight:models] → ${slug}`);
  const result = await spawnAgent({
    role: "worker",
    prompt: "Reply with exactly the two characters OK and nothing else.",
    cwd: projectRoot(),
    config: probeConfig,
    runDir,
    logKey: `preflight-${slug.replace(/[^\w.-]+/g, "_")}`,
    timeoutMs: 60_000,
  });
  const okText = /\bOK\b/i.test(result.output || "");
  const ok = result.ok && okText;
  console.log(
    `[preflight:models] ${ok ? "OK" : "FAIL"} ${slug} (${result.elapsedMs || Date.now() - started}ms)`
      + (ok ? "" : ` exit=${result.code} timedOut=${result.timedOut} out=${JSON.stringify((result.output || "").slice(0, 120))}`),
  );
  if (!ok) {
    failures.push(slug);
    if (/grok/i.test(slug)) {
      console.error(
        `[preflight:models] hint: if cursor-agent rejects "${slug}", try "grok-4.5-high-fast" manually — do NOT auto-substitute.`,
      );
    }
  }
}

if (failures.length) {
  console.error(`[preflight:models] FAILED: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("[preflight:models] all models accepted");
