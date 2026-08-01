import { mkdtempSync, rmSync, cpSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const taskRoot = join(__dirname, "..");
const skeletonSrc = join(taskRoot, "skeleton", "src");

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

const tempDir = mkdtempSync(join(tmpdir(), "sqlite-micro-skeleton-"));

try {
  writeFileSync(
    join(tempDir, "package.json"),
    JSON.stringify(
      {
        name: "mini-sql",
        type: "module",
        scripts: { build: "tsc" },
        devDependencies: {
          typescript: "^5.6.0",
          "@types/node": "^22.0.0",
        },
      },
      null,
      2,
    ),
  );

  writeFileSync(
    join(tempDir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          outDir: "dist",
          rootDir: "src",
          skipLibCheck: true,
        },
        include: ["src/**/*"],
      },
      null,
      2,
    ),
  );

  cpSync(skeletonSrc, join(tempDir, "src"), { recursive: true });

  let result = spawnSync("npm", ["install"], {
    cwd: tempDir,
    shell: true,
    stdio: "inherit",
  });
  if (result.status !== 0) fail("npm install failed");

  result = spawnSync("npm", ["run", "build"], {
    cwd: tempDir,
    shell: true,
    stdio: "inherit",
  });
  if (result.status !== 0) fail("npm run build failed");

  result = spawnSync("node", [join(tempDir, "dist", "cli.js")], {
    input: "SELECT 1;\n",
    encoding: "utf8",
  });
  if (result.status !== 0) {
    fail(`SELECT 1 exit ${result.status}: ${result.stderr}`);
  }
  const selectOut = result.stdout.trim();
  if (selectOut !== "[[1]]") {
    fail(`SELECT 1 stdout expected [[1]], got ${JSON.stringify(result.stdout)}`);
  }

  result = spawnSync("node", [join(tempDir, "dist", "cli.js")], {
    input: "",
    encoding: "utf8",
  });
  if (result.status !== 0) {
    fail(`empty input exit ${result.status}: ${result.stderr}`);
  }
  const emptyOut = result.stdout.trim();
  if (emptyOut !== "[]") {
    fail(`empty input stdout expected [], got ${JSON.stringify(result.stdout)}`);
  }

  console.log("PASS");
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
