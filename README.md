# mini-swarm

Minimal agent swarm orchestrator: reproduce Cursor's coordination-vs-throughput hypothesis on a **CommonMark core-subset renderer** task.

## Goal

Run A/B experiments comparing:

- **Run A (bare swarm)**: planner + workers, no scope enforcement, workers resolve merge conflicts themselves
- **Run B (coordinated swarm)**: disjoint file scopes, `DESIGN.md`, `GUIDE.md`, neutral merger on conflicts

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
npm run run:serial -- --quick # serial minimal loop (no worktrees)
npm run compare -- runs/run-a-bare-v3/metrics.json runs/run-b-coordinated-v3/metrics.json
```

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

- `planner_source`: `llm` or `seed`
- pass rate curve (`score_curve`)
- `merge_conflict_count` vs `scope_violation_count` (separate)
- `tasks_done` / per-task status
- lines of code, agent call timing

## Article lineage

Part of @js trilogy: loop → harness → **swarm**. Source blog: Cursor Agent Swarm Model Economics.
