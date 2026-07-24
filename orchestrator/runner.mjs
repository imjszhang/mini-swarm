import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

function resolveAgentExecutable(configured) {
  if (process.platform === "win32") {
    const cmd = path.join(process.env.LOCALAPPDATA || "", "cursor-agent", "cursor-agent.cmd");
    if (existsSync(cmd)) return { executable: cmd, shell: true };
  }
  return { executable: configured || "cursor-agent", shell: false };
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
  const model = config.models[role];
  if (!model) {
    return Promise.reject(new Error(`No model configured for role: ${role}`));
  }

  const cmd = config.agentCommand || "cursor-agent";
  const { executable, shell } = resolveAgentExecutable(cmd);
  // Prompt goes through stdin, not argv: coordinated prompts (DESIGN.md + GUIDE.md
  // inlined) exceed the Windows cmd.exe 8191-char argv limit and fail to spawn.
  const args = [
    "-p",
    "--force",
    "--trust",
    "--workspace",
    cwd,
    "--model",
    model,
    "--output-format",
    "text",
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
      env: { ...process.env },
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
        child.kill("SIGTERM");
      }, timeoutMs)
      : null;

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      const elapsedMs = Date.now() - started;
      const logBody = [
        `# spawnAgent ${logKey}`,
        `role=${role} model=${model}`,
        `exit=${code} elapsedMs=${elapsedMs} timedOut=${timedOut}`,
        "",
        "## stdout",
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
        output: stdout,
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
        stderr: err.message,
        elapsedMs: Date.now() - started,
        logPath,
        role,
        model,
      });
    });
  });
}
