/**
 * Windows-safe subprocess helpers.
 * Avoid shell:true without windowsHide — that flashes a cmd window per call.
 * npm.cmd/.bat still require shell:true on Windows (Node EINVAL otherwise).
 */
import { execFileSync, execSync } from "node:child_process";

export function npmExec(args, opts = {}) {
  const { cwd, stdio = "pipe", encoding = "utf8" } = opts;
  const quoted = args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ");
  return execSync(`npm ${quoted}`, {
    cwd,
    stdio,
    encoding,
    shell: true,
    windowsHide: true,
  });
}

export function taskkillPid(pid) {
  execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
}

export function powershellCommand(command, opts = {}) {
  return execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", command],
    {
      encoding: "utf8",
      stdio: opts.stdio ?? ["ignore", "pipe", "pipe"],
      windowsHide: true,
      timeout: opts.timeout,
      maxBuffer: opts.maxBuffer,
    },
  );
}
