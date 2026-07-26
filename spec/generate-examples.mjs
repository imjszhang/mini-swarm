#!/usr/bin/env node
/**
 * Differential test generator: template-driven markdown → reference HTML.
 * Seeds are synthetic (never derived from official examples.json) to avoid holdout leak.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OFFICIAL = path.join(ROOT, "spec", "examples.json");
// Separate from validate-scorer's .fixture-workspace to avoid Windows ENOTEMPTY races.
const FIXTURE = path.join(ROOT, "scorer", ".gen-fixture-workspace");
const DEFAULT_OUT = path.join(ROOT, "spec", "gen-examples-v12.json");

function mulberry32(seed) {
  let t = seed >>> 0;
  return function next() {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function seedToInt(seedStr) {
  const hex = createHash("sha1").update(String(seedStr)).digest("hex").slice(0, 8);
  return Number.parseInt(hex, 16) >>> 0;
}

function parseArgs(argv) {
  const args = { seed: "v12", count: 300, out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--seed") args.seed = argv[++i];
    else if (a === "--count") args.count = Number(argv[++i]);
    else if (a === "--out") args.out = path.resolve(argv[++i]);
  }
  return args;
}

function ensureFixture() {
  if (existsSync(path.join(FIXTURE, "node_modules", "commonmark"))) return;
  mkdirSync(path.join(FIXTURE, "dist"), { recursive: true });
  writeFileSync(path.join(FIXTURE, "package.json"), JSON.stringify({
    name: "fixture-commonmark",
    type: "module",
    scripts: { build: "node -e \"console.log('ok')\"" },
    dependencies: { commonmark: "^0.31.2" },
  }, null, 2));
  writeFileSync(path.join(FIXTURE, "dist", "cli.js"), `import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const commonmark = require("commonmark");
const reader = new commonmark.Parser();
const writer = new commonmark.HtmlRenderer();
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const parsed = reader.parse(input);
  process.stdout.write(writer.render(parsed));
});
`);
  const npm = spawnSync("npm", ["install"], { cwd: FIXTURE, encoding: "utf8", shell: true });
  if (npm.status !== 0) {
    console.error(npm.stderr || npm.stdout);
    process.exit(1);
  }
}

function renderRef(markdown) {
  const cli = path.join(FIXTURE, "dist", "cli.js");
  const result = spawnSync(process.execPath, [cli], {
    cwd: FIXTURE,
    input: markdown,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 15_000,
  });
  if (result.status !== 0) {
    return { ok: false, error: (result.stderr || result.stdout || "fail").trim() };
  }
  return { ok: true, html: result.stdout };
}

const WORDS = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa"];
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const word = (rng) => pick(rng, WORDS);
const words = (rng, n) => Array.from({ length: n }, () => word(rng)).join(" ");

/** Template factories: () => { section, markdown } — synthetic only. */
const TEMPLATES = [
  {
    section: "Emphasis and strong emphasis",
    weight: 4,
    make: (rng) => {
      const a = word(rng);
      const b = word(rng);
      const styles = [
        `*${a}* and **${b}**`,
        `_${a}_ with __${b}__`,
        `***${a} ${b}***`,
        `*${a} **${b}** ${word(rng)}*`,
        `**${a} *${b}* ${word(rng)}**`,
        `a * ${a} * b`,
        `*${a}*${b}*${word(rng)}*`,
      ];
      return pick(rng, styles);
    },
  },
  {
    section: "Links",
    weight: 2,
    make: (rng) => {
      const label = words(rng, 1 + Math.floor(rng() * 3));
      const dest = `https://example.test/${word(rng)}`;
      const styles = [
        `[${label}](${dest})`,
        `[${label}](${dest} "${word(rng)}")`,
        `[${label}](/${word(rng)})`,
        `![${label}](/img/${word(rng)}.png)`,
      ];
      return pick(rng, styles);
    },
  },
  {
    section: "Images",
    weight: 1,
    make: (rng) => `![${words(rng, 2)}](/${word(rng)}.jpg "${word(rng)}")`,
  },
  {
    section: "Code spans",
    weight: 2,
    make: (rng) => {
      const code = `${word(rng)}_${word(rng)}`;
      return pick(rng, [
        `Use \`${code}\` here.`,
        `\`\` ${code} \`\``,
        `Before \`${code}\` after.`,
      ]);
    },
  },
  {
    section: "Fenced code blocks",
    weight: 2,
    make: (rng) => {
      const lang = pick(rng, ["", "js", "ts", "python"]);
      const body = `${word(rng)}();\n  ${word(rng)};`;
      return `\`\`\`${lang}\n${body}\n\`\`\``;
    },
  },
  {
    section: "Indented code blocks",
    weight: 1,
    make: (rng) => `    ${word(rng)}()\n    ${word(rng)};`,
  },
  {
    section: "List items",
    weight: 2,
    make: (rng) => {
      const n = 2 + Math.floor(rng() * 3);
      const items = Array.from({ length: n }, (_, i) =>
        (rng() < 0.5 ? `- ${words(rng, 2)}` : `${i + 1}. ${words(rng, 2)}`));
      return items.join("\n");
    },
  },
  {
    section: "Lists",
    weight: 2,
    make: (rng) => {
      const a = words(rng, 2);
      const b = words(rng, 2);
      return `- ${a}\n\n- ${b}\n  - nested ${word(rng)}`;
    },
  },
  {
    section: "Block quotes",
    weight: 2,
    make: (rng) => {
      const styles = [
        `> ${words(rng, 4)}`,
        `> ${words(rng, 3)}\n>\n> ${words(rng, 2)}`,
        `> ${words(rng, 2)}\n>> nested ${word(rng)}`,
      ];
      return pick(rng, styles);
    },
  },
  {
    section: "ATX headings",
    weight: 1,
    make: (rng) => {
      const level = 1 + Math.floor(rng() * 3);
      return `${"#".repeat(level)} ${words(rng, 3)}`;
    },
  },
  {
    section: "Setext headings",
    weight: 1,
    make: (rng) => {
      const title = words(rng, 3);
      const under = rng() < 0.5 ? "=" : "-";
      return `${title}\n${under.repeat(Math.max(3, title.length))}`;
    },
  },
  {
    section: "Thematic breaks",
    weight: 1,
    make: (rng) => pick(rng, ["***", "---", "___", "* * *"]),
  },
  {
    section: "Hard line breaks",
    weight: 1,
    make: (rng) => `${words(rng, 2)}  \n${words(rng, 2)}`,
  },
  {
    section: "Paragraphs",
    weight: 1,
    make: (rng) => `${words(rng, 5)}.\n\n${words(rng, 4)}.`,
  },
  {
    section: "Tabs",
    weight: 1,
    make: (rng) => `\t${word(rng)}\n\t${word(rng)}`,
  },
  {
    section: "Backslash escapes",
    weight: 1,
    make: (rng) => `\\*not emphasis\\* and \\[not a link\\]`,
  },
];

function weightedPick(rng) {
  const total = TEMPLATES.reduce((s, t) => s + t.weight, 0);
  let r = rng() * total;
  for (const t of TEMPLATES) {
    r -= t.weight;
    if (r <= 0) return t;
  }
  return TEMPLATES[TEMPLATES.length - 1];
}

function loadOfficialMarkdownSet() {
  if (!existsSync(OFFICIAL)) return new Set();
  const examples = JSON.parse(readFileSync(OFFICIAL, "utf8"));
  return new Set(examples.map((e) => e.markdown));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  ensureFixture();
  const official = loadOfficialMarkdownSet();
  const rng = mulberry32(seedToInt(args.seed));
  const out = [];
  const seen = new Set();
  let attempts = 0;
  const maxAttempts = args.count * 20;

  while (out.length < args.count && attempts < maxAttempts) {
    attempts += 1;
    const tmpl = weightedPick(rng);
    const markdown = `${tmpl.make(rng)}\n`;
    if (official.has(markdown) || seen.has(markdown)) continue;
    const rendered = renderRef(markdown);
    if (!rendered.ok) continue;
    seen.add(markdown);
    const id = `gen-${String(out.length + 1).padStart(4, "0")}`;
    out.push({
      id,
      section: tmpl.section,
      markdown,
      html: rendered.html,
    });
  }

  if (out.length < args.count) {
    console.error(`[spec:generate] only produced ${out.length}/${args.count} (attempts=${attempts})`);
    process.exit(1);
  }

  // Self-check: every example re-renders identically.
  for (const ex of out) {
    const again = renderRef(ex.markdown);
    if (!again.ok || again.html !== ex.html) {
      console.error(`[spec:generate] self-check failed for ${ex.id}`);
      process.exit(1);
    }
    if (official.has(ex.markdown)) {
      console.error(`[spec:generate] leaked official example at ${ex.id}`);
      process.exit(1);
    }
  }

  writeFileSync(args.out, `${JSON.stringify(out, null, 2)}\n`, "utf8");
  console.log(`[spec:generate] wrote ${out.length} examples → ${args.out} (seed=${args.seed})`);
}

main();
