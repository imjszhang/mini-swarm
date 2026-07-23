# mini-swarm

Minimal agent swarm orchestrator: reproduce Cursor's coordination-vs-throughput hypothesis on a **CommonMark core-subset renderer** task.

## Goal

Run A/B experiments comparing:

- **Run A (bare swarm)**: planner + workers, no scope enforcement, workers resolve merge conflicts themselves
- **Run B (coordinated swarm)**: disjoint file scopes, `DESIGN.md`, `GUIDE.md`, neutral merger on conflicts

Fixed model routing: strong planner, cheap workers (`config.json`).

## Prerequisites

- Node.js 20+
- Git
- `cursor-agent` CLI (logged in)
- `npm install` only needed for scorer validation (`commonmark` dev dependency)

## Quick start

```bash
npm run spec:extract          # parse CommonMark spec → spec/examples.json
npm run score                 # score workspace implementation (needs dist/cli.js)
npm run smoke:runner          # verify cursor-agent spawn works
npm run run                   # Run A (coordination=false)
npm run run:coordinated       # Run B (coordination=true)
```

## Layout

```
spec/           CommonMark spec + extracted test examples
scorer/         Automated pass-rate scoring
orchestrator/   Planner/worker/merge orchestration
prompts/        Role prompt templates
runs/           Experiment outputs (metrics, logs, tasks)
workspace/      Renderer built by agents (gitignored, reset per run)
```

## Scoring contract

Workspace must expose:

```bash
node dist/cli.js   # stdin = markdown, stdout = HTML
```

Scorer compares output to `spec/examples.json` (core subset, ~400 cases).

## Metrics

Each run writes `runs/{runId}/metrics.json`:

- pass rate curve (sampled after merges)
- merge conflict count
- lines of code
- per-task timing
- coordination mode

## Article lineage

Part of @js trilogy: loop → harness → **swarm**. Source blog: Cursor Agent Swarm Model Economics.
