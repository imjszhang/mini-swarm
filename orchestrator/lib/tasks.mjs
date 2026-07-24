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

/**
 * High-contention task set for v8 scale-pressure experiments.
 * @param {string} coordMode "none" | "strict" | "faithful"
 */
export function contentionTasks(coordMode = "none") {
  const bare = coordMode === "none";
  const shared = ["src/types.ts", "src/render.ts"];
  const blockShared = [...shared, "src/blocks/registry.ts"];
  const inlineShared = [...shared, "src/inline/registry.ts"];

  const noteBare = "Implement parser and wire it into registry.ts and render.ts yourself.";
  const noteBlockFaithful =
    "Implement parser in your module; register it in src/blocks/registry.ts and add the render case in src/render.ts via minimal cross-scope patches (cross-scope: register <feature>).";
  const noteInlineFaithful =
    "Implement parser in your module; register it in src/inline/registry.ts and add the render case in src/render.ts via minimal cross-scope patches (cross-scope: register <feature>).";

  function blockTask(id, title, spec_sections, modulePath) {
    return {
      id,
      title,
      spec_sections,
      files_scope: bare ? [modulePath, ...blockShared] : [modulePath],
      status: "pending",
      attempts: 0,
      notes: bare ? noteBare : noteBlockFaithful,
    };
  }

  function inlineTask(id, title, spec_sections, modulePath) {
    return {
      id,
      title,
      spec_sections,
      files_scope: bare ? [modulePath, ...inlineShared] : [modulePath],
      status: "pending",
      attempts: 0,
      notes: bare ? noteBare : noteInlineFaithful,
    };
  }

  return [
    {
      id: "task-01",
      title: "Core pipeline: index, CLI, types, registries, render",
      spec_sections: ["Paragraphs"],
      files_scope: [
        "src/index.ts",
        "src/cli.ts",
        "src/types.ts",
        "src/render.ts",
        "src/blocks/registry.ts",
        "src/inline/registry.ts",
      ],
      status: "pending",
      attempts: 0,
      notes:
        "Improve the shared pipeline stub so later tasks can register parsers. Keep tsc green. Do not implement every CommonMark feature here.",
    },
    blockTask("task-02", "ATX headings", ["ATX headings"], "src/blocks/headings.ts"),
    blockTask("task-03", "Setext headings", ["Setext headings"], "src/blocks/setext.ts"),
    blockTask("task-04", "Paragraphs and blank lines", ["Paragraphs", "Blank lines"], "src/blocks/paragraphs.ts"),
    blockTask("task-05", "Lists and list items", ["List items", "Lists"], "src/blocks/lists.ts"),
    blockTask("task-06", "Block quotes", ["Block quotes"], "src/blocks/blockquote.ts"),
    blockTask("task-07", "Thematic breaks", ["Thematic breaks"], "src/blocks/thematic.ts"),
    blockTask("task-08", "Fenced code blocks", ["Fenced code blocks"], "src/blocks/fenced.ts"),
    blockTask("task-09", "Indented code blocks", ["Indented code blocks"], "src/blocks/indented.ts"),
    inlineTask("task-10", "Emphasis and strong emphasis", ["Emphasis and strong emphasis"], "src/inline/emphasis.ts"),
    inlineTask("task-11", "Code spans", ["Code spans"], "src/inline/codespan.ts"),
    inlineTask("task-12", "Links and images", ["Links", "Images"], "src/inline/links.ts"),
  ];
}

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

/**
 * @param {string} workspaceDir
 * @param {string} [taskSet="default"] "default" | "contention"
 * @param {string} [coordMode="none"] "none" | "strict" | "faithful"
 */
export function seedTasks(workspaceDir, taskSet = "default", coordMode = "none") {
  const tasks = taskSet === "contention" ? contentionTasks(coordMode) : DEFAULT_TASKS;
  saveTasks(workspaceDir, tasks);
  return tasks;
}

export function validateDisjointScopes(tasks, { skipTaskIds = [] } = {}) {
  const skip = new Set(skipTaskIds);
  const fileToTask = new Map();
  const violations = [];
  for (const task of tasks) {
    if (skip.has(task.id)) continue;
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
