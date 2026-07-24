import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { projectRoot } from "./config.mjs";

export const DEFAULT_TASKS = [
  {
    id: "task-01",
    title: "Extend CLI stub and index orchestrator",
    spec_sections: ["Paragraphs"],
    files_scope: ["src/cli.ts", "src/index.ts"],
    status: "pending",
    attempts: 0,
    notes: "Skeleton pre-exists (package.json, tsconfig); improve renderMarkdown stub, ensure tsc passes",
  },
  {
    id: "task-02",
    title: "ATX and Setext headings",
    spec_sections: ["ATX headings", "Setext headings"],
    files_scope: ["src/headings.ts"],
    status: "pending",
    attempts: 0,
    notes: "",
  },
  {
    id: "task-03",
    title: "Paragraphs and blank lines",
    spec_sections: ["Paragraphs", "Blank lines"],
    files_scope: ["src/paragraphs.ts"],
    status: "pending",
    attempts: 0,
    notes: "",
  },
  {
    id: "task-04",
    title: "Lists and list items",
    spec_sections: ["List items", "Lists"],
    files_scope: ["src/lists.ts"],
    status: "pending",
    attempts: 0,
    notes: "",
  },
  {
    id: "task-05",
    title: "Block quotes and thematic breaks",
    spec_sections: ["Block quotes", "Thematic breaks"],
    files_scope: ["src/blockquote.ts", "src/thematic.ts"],
    status: "pending",
    attempts: 0,
    notes: "",
  },
  {
    id: "task-06",
    title: "Fenced and indented code blocks",
    spec_sections: ["Fenced code blocks", "Indented code blocks"],
    files_scope: ["src/codeblock.ts"],
    status: "pending",
    attempts: 0,
    notes: "",
  },
  {
    id: "task-07",
    title: "Emphasis and code spans",
    spec_sections: ["Emphasis and strong emphasis", "Code spans"],
    files_scope: ["src/inline.ts"],
    status: "pending",
    attempts: 0,
    notes: "",
  },
  {
    id: "task-08",
    title: "Links and images",
    spec_sections: ["Links", "Images"],
    files_scope: ["src/links.ts"],
    status: "pending",
    attempts: 0,
    notes: "",
  },
];

export function loadTasks(workspaceDir) {
  const p = path.join(workspaceDir, "tasks.json");
  if (!existsSync(p)) return null;
  try {
    const data = JSON.parse(readFileSync(p, "utf8"));
    return Array.isArray(data) ? data : data.tasks || null;
  } catch {
    return null;
  }
}

export function saveTasks(workspaceDir, tasks) {
  writeFileSync(path.join(workspaceDir, "tasks.json"), `${JSON.stringify(tasks, null, 2)}\n`, "utf8");
}

export function seedTasks(workspaceDir) {
  saveTasks(workspaceDir, DEFAULT_TASKS);
  return DEFAULT_TASKS;
}

export function validateDisjointScopes(tasks) {
  const fileToTask = new Map();
  const violations = [];
  for (const task of tasks) {
    for (const file of task.files_scope || []) {
      if (fileToTask.has(file)) {
        violations.push({ file, tasks: [fileToTask.get(file), task.id] });
      } else {
        fileToTask.set(file, task.id);
      }
    }
  }
  return violations;
}

export function sectionSummary() {
  const examples = JSON.parse(readFileSync(path.join(projectRoot(), "spec", "examples.json"), "utf8"));
  const counts = {};
  for (const ex of examples) {
    counts[ex.section] = (counts[ex.section] || 0) + 1;
  }
  return counts;
}
