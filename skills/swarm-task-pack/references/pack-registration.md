# Orchestrator touchpoints for a new pack `{id}`

Complete list of code locations to edit. Everything else (planner loop, merge
queue, stop policies, holdout, reports) is pack-agnostic and needs no change.

## 1. Directory layout

```
tasks/{id}/
  TASK.md                     # charter (from templates/TASK.md)
  spec/
    spec.txt                  # generated normative text
    examples.json             # hidden oracle (generated)
    sections.json             # section list (generated)
  prompts/
    swarm-planner.md          # copied from toml-json, task paragraphs edited
    swarm-worker.md
  scripts/
    import-{source}.mjs       # vendor → examples.json + sections.json
    gen-spec-txt.mjs          # examples/source text → spec.txt
  vendor/                     # pinned upstream suite (+ vendor/README.md with tag)
```

## 2. `orchestrator/lib/task-pack.mjs`

- Add `"{id}"` to `listTaskPackIds()`.
- Add a branch in `resolveTaskPack()` returning:

```js
{
  id: "{id}",
  root: path.join(ROOT, "tasks", "{id}"),
  specDir, examplesPath, specTextPath,          // under tasks/{id}/spec/
  sectionsPath: path.join(root, "spec", "sections.json"),
  promptsDir: path.join(root, "prompts"),
  skeleton: "{id}",                             // matches workspace.mjs branch
  canaryInput: "…minimal valid input…\n",
  canaryRequireExit0: true,
  goalLabel: "…one-line goal…",
}
```

Resolver already validates that `examplesPath` and `specTextPath` exist.

## 3. `orchestrator/lib/workspace.mjs` — skeleton

Add a branch in `initSwarmSkeleton` (`skeleton === "{id}"`) that writes a
compilable TypeScript stub. Follow `writeTomlStubs`:

- `package.json` (`build: tsc`) + `tsconfig.json` — provided by the shared code.
- `src/cli.ts` — implements the CLI contract: read stdin, write stdout, exit
  non-zero on error via `console.error` + `process.exit(1)`.
- `src/contracts.ts` — compile-checked re-exports of the seams workers must keep.
- Registry modules (e.g. `src/values/registry.ts`) so parallel workers register
  parsers instead of editing one shared dispatch file. This is the main
  merge-conflict-avoidance device; design registries around your spec's sections.
- The stub must already handle the canary input (e.g. toml stub parses bare
  `key = integer`) so post-merge health checks pass from commit zero.

## 4. Output comparator (only if not exact-text)

- `orchestrator/lib/spec-embedded-check.mjs` → `compareCliOutput`: add a
  `packId === "{id}"` branch.
- `scorer/score.mjs`: mirror the same equivalence there.

Skip if plain normalized-text equality is correct for your task.

## 5. Prompts

Copy `tasks/toml-json/prompts/swarm-planner.md` and `swarm-worker.md`. Edit only:
goal statement, CLI contract, domain-specific guidance, section naming hints.
Do **not** touch the audit/convergence rules, hidden-grader wording, or the
Field Guide protocol — those are harness contracts.

## 6. `package.json` scripts

```json
"task:{id}:import":   "node tasks/{id}/scripts/import-….mjs && node tasks/{id}/scripts/gen-spec-txt.mjs",
"swarm:{id}:mock":    "node orchestrator/swarm.mjs --mock --task={id}",
"swarm:{id}:smoke":   "node orchestrator/swarm.mjs --task={id} --budget-minutes=20 --concurrency=2",
"swarm:{id}:detached":"node orchestrator/swarm.mjs --task={id} --run-to-done --detach"
```

## 7. Docs

- `tasks/{id}/TASK.md` from the template.
- Root `README.md`: mention the pack where toml-json is mentioned (task list).
- `EXPERIMENTS.md`: add a protocol entry when the first real run happens (not
  part of pack creation).
