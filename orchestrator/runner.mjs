import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveModel } from "./lib/config.mjs";

/** Kill agent process tree (Windows SIGTERM often leaves cursor-agent grandchildren alive). */
function killAgentTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      return;
    } catch {
      /* fall through */
    }
  }
  try { child.kill("SIGTERM"); } catch { /* ignore */ }
  try { child.kill("SIGKILL"); } catch { /* ignore */ }
}

/**
 * Version directory sort key matching cursor-agent.ps1 (YYYYMMDD as int).
 * Avoids launching cursor-agent.cmd → powershell → node (two console flashes).
 */
function versionSortKey(name) {
  const datePart = String(name).split("-")[0];
  const parts = datePart.split(".");
  if (parts.length !== 3) return 0;
  const year = parts[0];
  const month = parts[1].padStart(2, "0");
  const day = parts[2].padStart(2, "0");
  const n = Number(`${year}${month}${day}`);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Resolve agent launch to a direct node.exe + index.js on Windows when possible.
 * @returns {{ executable: string, argsPrefix: string[], shell: boolean }}
 */
function resolveAgentExecutable(configured) {
  if (process.platform === "win32") {
    const base = path.join(process.env.LOCALAPPDATA || "", "cursor-agent");
    const versionsDir = path.join(base, "versions");
    if (existsSync(versionsDir)) {
      let dirs = [];
      try {
        dirs = readdirSync(versionsDir, { withFileTypes: true })
          .filter((d) => d.isDirectory() && /^\d{4}\.\d{1,2}\.\d{1,2}/.test(d.name))
          .map((d) => d.name)
          .sort((a, b) => versionSortKey(b) - versionSortKey(a));
      } catch {
        dirs = [];
      }
      for (const name of dirs) {
        const nodePath = path.join(versionsDir, name, "node.exe");
        const indexPath = path.join(versionsDir, name, "index.js");
        if (existsSync(nodePath) && existsSync(indexPath)) {
          return {
            executable: nodePath,
            argsPrefix: [indexPath],
            shell: false,
            envExtra: { CURSOR_INVOKED_AS: "cursor-agent" },
          };
        }
      }
    }
    // Last resort: .cmd still needs a shell, but windowsHide suppresses the window.
    const cmd = path.join(base, "cursor-agent.cmd");
    if (existsSync(cmd)) {
      return { executable: cmd, argsPrefix: [], shell: true, envExtra: {} };
    }
  }
  return {
    executable: configured || "cursor-agent",
    argsPrefix: [],
    shell: false,
    envExtra: {},
  };
}

/**
 * Parse the final `{"type":"result",...}` event emitted by
 * `cursor-agent --output-format json`. Scans lines from the end so stray
 * warnings on stdout don't break parsing. Returns null when absent
 * (crash/timeout/legacy CLI) so callers can fall back to raw stdout.
 */
function parseResultEvent(stdout) {
  const lines = String(stdout || "").split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line.startsWith("{")) continue;
    try {
      const evt = JSON.parse(line);
      if (evt && evt.type === "result") return evt;
    } catch { /* keep scanning */ }
  }
  return null;
}

/**
 * Extract the metrics fields every recordAgentCall site should attach:
 * model, wall/API duration and real token usage (核心指标 #3).
 * Spread into the entry: metrics.recordAgentCall({ role, ..., ...agentUsage(result) }).
 */
export function agentUsage(result) {
  const u = result?.usage || null;
  return {
    model: result?.model ?? null,
    elapsedMs: result?.elapsedMs ?? null,
    api_ms: result?.apiMs ?? null,
    tokens_in: u ? (u.input_tokens ?? 0) : null,
    tokens_out: u ? (u.output_tokens ?? 0) : null,
    tokens_cache_read: u ? (u.cache_read_tokens ?? 0) : null,
    tokens_cache_write: u ? (u.cache_write_tokens ?? 0) : null,
  };
}

/**
 * Spawn cursor-agent (or config.agentCommand) in headless mode.
 */
export function spawnAgent({
  role,
  prompt,
  cwd,
  config,
  runDir,
  logKey = role,
  timeoutMs,
}) {
  const model = resolveModel(config, role);
  if (!model) {
    return Promise.reject(new Error(`No model configured for role: ${role}`));
  }

  const cmd = config.agentCommand || "cursor-agent";
  const { executable, shell, argsPrefix, envExtra } = resolveAgentExecutable(cmd);
  // Prompt goes through stdin, not argv: coordinated prompts (DESIGN.md + GUIDE.md
  // inlined) exceed the Windows cmd.exe 8191-char argv limit and fail to spawn.
  const args = [
    ...argsPrefix,
    "-p",
    "--force",
    "--trust",
    "--workspace",
    cwd,
    "--model",
    model,
    // json (not text): the final result event carries usage.{input,output,cache*}Tokens
    // and duration_api_ms, which feed the four core metrics (token cost / time).
    "--output-format",
    "json",
  ];

  const logDir = path.join(runDir, "logs");
  mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, `${logKey}.log`);
  writeFileSync(path.join(logDir, `${logKey}-prompt.txt`), prompt, "utf8");

  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(executable, args, {
      cwd,
      shell,
      windowsHide: true,
      env: {
        ...process.env,
        ...envExtra,
        // Prefer Node compile cache like the official launcher.
        NODE_COMPILE_CACHE: process.env.NODE_COMPILE_CACHE
          || path.join(process.env.LOCALAPPDATA || "", "cursor-compile-cache"),
      },
    });

    child.stdin?.on("error", () => {});
    child.stdin?.write(prompt);
    child.stdin?.end();

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });

    let timedOut = false;
    const timer = timeoutMs
      ? setTimeout(() => {
        timedOut = true;
        killAgentTree(child);
        // Second strike if close still hasn't fired (defensive).
        setTimeout(() => killAgentTree(child), 5000);
      }, timeoutMs)
      : null;

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      const elapsedMs = Date.now() - started;

      // Prefer the structured result event; fall back to raw stdout so a
      // crash/timeout (no result event) behaves exactly like the old text mode.
      const evt = parseResultEvent(stdout);
      const output = evt && evt.result != null ? String(evt.result) : stdout;
      const usage = evt?.usage
        ? {
          input_tokens: evt.usage.inputTokens ?? 0,
          output_tokens: evt.usage.outputTokens ?? 0,
          cache_read_tokens: evt.usage.cacheReadTokens ?? 0,
          cache_write_tokens: evt.usage.cacheWriteTokens ?? 0,
        }
        : null;
      const apiMs = evt?.duration_api_ms ?? evt?.duration_ms ?? null;

      const logBody = [
        `# spawnAgent ${logKey}`,
        `role=${role} model=${model}`,
        `exit=${code} elapsedMs=${elapsedMs} apiMs=${apiMs ?? "-"} timedOut=${timedOut}`,
        usage
          ? `tokens in=${usage.input_tokens} out=${usage.output_tokens} cacheRead=${usage.cache_read_tokens} cacheWrite=${usage.cache_write_tokens}`
          : "tokens (no usage event)",
        "",
        "## result",
        output,
        "",
        "## raw stdout (json)",
        stdout,
        "",
        "## stderr",
        stderr,
      ].join("\n");
      writeFileSync(logPath, logBody, "utf8");
      resolve({
        ok: code === 0 && !timedOut,
        code,
        timedOut,
        output,
        rawOutput: stdout,
        usage,
        apiMs,
        stderr,
        elapsedMs,
        logPath,
        role,
        model,
      });
    });

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      writeFileSync(logPath, `spawn error: ${err.message}`, "utf8");
      resolve({
        ok: false,
        code: -1,
        timedOut: false,
        output: "",
        rawOutput: "",
        usage: null,
        apiMs: null,
        stderr: err.message,
        elapsedMs: Date.now() - started,
        logPath,
        role,
        model,
      });
    });
  });
}
