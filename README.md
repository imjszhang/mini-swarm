# mini-swarm

Minimal agent swarm orchestrator: reproduce Cursor's coordination-vs-throughput hypothesis on a **CommonMark core-subset renderer** task.

## Goal

Run A/B experiments comparing:

- **Run A (bare swarm)**: planner + workers, no scope enforcement, workers resolve merge conflicts themselves
- **Run B strict**: disjoint hard file scopes, `DESIGN.md`, `GUIDE.md`, neutral merger
- **Run B faithful**: scopes are primary ownership (targeted cross-scope patches allowed), living `DESIGN.md`, `GUIDE.md`, neutral merger, and build-failure integration repair

Fixed model routing: planner and workers use `composer-2.5-fast` by default (`config.json`). Planner falls back to seed `tasks.json` if the LLM call fails.

## Prerequisites

- Node.js 20+
- Git
- `cursor-agent` CLI (logged in)

## Quick start

```bash
npm run spec:extract          # parse CommonMark spec → spec/examples.json (525 cases)
npm run score                 # score workspace implementation (needs dist/cli.js)
npm run smoke:runner          # verify cursor-agent spawn works
npm run run:quick             # Run A bare (3 tasks, concurrency 2)
npm run run:quick:coordinated # Run B coordinated
npm run run:faithful          # Run B faithful, full task set
npm run run:contention:bare   # high-contention bare (13 tasks, concurrency 4, score feedback)
npm run run:contention:faithful
npm run run:serial -- --quick # serial minimal loop (no worktrees)
npm run compare -- runs/run-a-bare-contention-v9b/metrics.json runs/run-b-faithful-contention-v9/metrics.json

# Resume an interrupted run (task-level; requires progress.json)
npm run salvage -- --run-id=RUN_ID --task-set=contention   # rebuild progress from wreckage
npm run run:contention:bare -- --run-id=RUN_ID --resume    # continue skipped done tasks
```

CLI flags of note: `--task-set=default|contention` (contention uses a fixed seed planner for fair A/B), `--coord-mode=strict|faithful`, `--concurrency=N`, `--resume` (requires `--run-id` + `progress.json`; see `npm run salvage`). Contention runs use harness score-feedback (`maxScoreFeedbackRounds` in `config.json`).

### Resume semantics

- Granularity is **per task**: already-merged tasks are skipped; in-flight LLM turns are not resumed.
- Interrupted runs without `progress.json` need `npm run salvage` first (fingerprint flags must match the original command).
- Quality metrics (pass rate, LOC, churn, commits) are cumulative for the whole run; agent/wall time in `metrics.json` covers only the **last resume segment** (`resumed: true`, `resume_segment: N`).

## Layout

```
spec/           CommonMark spec + extracted test examples
scorer/         Automated pass-rate scoring
orchestrator/   Planner/worker/merge orchestration
prompts/        Role prompt templates
runs/           Experiment outputs (metrics, logs, tasks)
```

Each run writes `runs/{runId}/workspace/` (gitignored) and `metrics.json`.

## Scoring contract

Workspace must expose:

```bash
node dist/cli.js   # stdin = markdown, stdout = HTML
```

Scorer compares output to `spec/examples.json` (**525** core-subset cases; HTML blocks / autolinks etc. excluded).

## Metrics

Each run writes `runs/{runId}/metrics.json`:

- `planner_source`: `llm`, `seed`, or `seed-contention`
- `task_set`: `default` or `contention`
- pass rate curve (`score_curve`)
- `merge_conflict_count` vs `scope_violation_count` (separate)
- `coordination_mode`: `none`, `strict`, or `faithful`
- `cross_scope_change_count` and `integration_fix_count` (faithful mode)
- `churn` (`total_added` / `total_deleted` / `churn_ratio`) and `merge_resolve_time_ms`
- `score_feedback_count` / `worker_fix_time_ms` (section-scoped fix rounds)
- `worktree_sync_count` / `merge_gate_rejection_count` / `global_repair_*` (v10 architecture)
- `resumed` / `resume_segment` when continued via `--resume`
- `tasks_done` / per-task status
- lines of code, agent call timing

Each live run also writes `progress.json` (task statuses + phase) for crash recovery.

## Article lineage

Part of @js trilogy: loop → harness → **swarm**. Source blog: Cursor Agent Swarm Model Economics.

## Fidelity boundary

`faithful` reproduces a small, Git-backed subset of Cursor's newer swarm framework:

- planner/worker context specialization
- shared design decisions and a worker-maintained Field Guide
- neutral third-party conflict resolution
- targeted cross-scope patches instead of hard rejection
- compiler failures feeding an integration-fix loop
- compile-checked interface stubs via `src/contracts.ts` (contention / faithful)

v10 adds VCS-layer merge validity gating, worktree freshness sync, and a final global repair phase (both arms). Task-level `--resume` / `salvage` recover interrupted runs.

It does **not** reproduce Cursor's custom high-throughput VCS, multiple planner trees, bloated-file decomposition, or stacked multi-perspective review. Results measure this minimal reproduction, not Cursor's production swarm.
