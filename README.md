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
- `cursor-agent` CLI + `CURSOR_API_KEY` in project `.env` (see `.env.example`; copied from js-evolution-agent, **ortle3x3** account — no `cursor-agent login` required)

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
npm run compare -- runs/run-a-bare-v12-repair/metrics.json runs/run-b-faithful-v12-repair/metrics.json
npm run contention:report -- runs/RUN_ID/metrics.json
npm run spec:generate         # synthetic gen-examples for Stage B self-verify
npm run preflight:models      # probe composer + strong model slugs

# v13 / v13.1 / v13.2 / v13.3 Cursor-faithful swarm (S-A-008; hidden grader)
npm run swarm:mock            # scripted planner/worker end-to-end
npm run swarm                 # budget mode (default 240 min)
npm run swarm:done            # run-to-done (hard stop maxWallMinutes, default 480)
npm run swarm:smoke           # live smoke: 15 min, concurrency 2
npm run swarm:detached -- --run-id=run-swarm-v13.3 --concurrency=8   # long run outside IDE terminal
npm run swarm:resume -- --run-id=RUN_ID              # resume interrupted swarm (tree.json + checkpoint)
npm run swarm:finalize -- --run-id=RUN_ID            # score+finalize metrics without resuming

# Task packs (default commonmark; also toml-json, sqlite-micro)
npm run task:sqlite:import      # regenerate sqlite-micro oracle + spec.txt
npm run swarm:sqlite:mock       # mock swarm on sqlite-micro
npm run swarm:sqlite:smoke      # live 20 min smoke
npm run swarm:sqlite:detached   # long run --task=sqlite-micro

# Solo single-agent baseline (same packs + hidden grader; for swarm vs solo compare)
npm run solo:mock               # scripted turns; no LLM
npm run solo:smoke              # live 15 min / max 4 turns
npm run solo:detached -- --run-id=run-solo-v1
npm run solo:resume -- --run-id=RUN_ID
npm run solo:toml:detached -- --run-id=run-solo-toml-v1
npm run solo:sqlite:detached -- --run-id=run-solo-sqlite-v1
npm run test:solo               # stop-policy unit tests
# Finalize interrupted solo/swarm: npm run swarm:finalize -- --run-id=RUN_ID

# Resume an interrupted legacy run (task-level; requires progress.json)
npm run salvage -- --run-id=RUN_ID --task-set=contention   # rebuild progress from wreckage
npm run run:contention:bare -- --run-id=RUN_ID --resume    # continue skipped done tasks

# v12 repair-only continuation from a prior run's workspace (preserves holdout split)
npm run run -- --repair-only --from-run=run-a-bare-contention-v11 --run-id=run-a-bare-v12-repair --task-set=contention
npm run run:contention:faithful -- --run-id=run-b-faithful-contention-v12
```

CLI flags of note: `--task-set=default|contention` (contention uses a fixed seed planner for fair A/B), `--coord-mode=strict|faithful`, `--concurrency=N`, `--resume` (requires `--run-id` + `progress.json`; see `npm run salvage`), `--repair-only --from-run=ID` (copy workspace/holdout/ledger and run Stage A→B only), `--contention-report=PATH` (injects historical hot-file stats into the LLM planner; no-op for fixed contention seeds).

### v11 quality loop (generic harness)

Both arms share the same post-pool repair architecture (task-agnostic mechanism code under `orchestrator/`):

- **Corrected oracle**: `spec/extract.mjs` substitutes typographic `→` → real tab on markdown + expected HTML (official CommonMark runner semantics). Historical v9/v10 headline numbers stay as the old oracle; dual-track `score-corrected-oracle.json` re-scores existing workspaces.
- **Holdout**: stratified seeded blind set in `runs/{id}/holdout.json`. Agent feedback scores use `--holdout-mode exclude`; final metrics report `visible_score` / `holdout_score` / `final_score` (full suite). Holdout secrecy is best-effort (agents could read repo files); prompts forbid it, and `oracle_literal_hits` + `holdout_gap_pp` alarm for overfitting.
- **Ledger + adjudication**: stuck failures are classified (`implementation_bug` | `suspected_oracle_bug` | `spec_ambiguity` | `out_of_scope_dependency`). Oracle/ambiguity verdicts leave the repair queue for human review — agents never edit the acceptance suite.
- **Repair engine**: adaptive clustering → monotonic changeset acceptance → best-of-N candidate worktrees on reject. Config under `config.repair` / `config.holdout`.

### v12 generalization loop

Builds on v11 with Cursor-inspired levers (spec-driven feedback, strong-model ladder, review ROI):

- **Parse fix**: adjudication/cluster now read `spawnAgent` `output` (v11 silently fell back).
- **Model tiering**: cheap `composer-2.5-fast` for workers/rung1–2; `models.strong` (`cursor-grok-4.5-high-fast`) for adjudicator / cluster / decomposer / rung3.
- **Gen-examples**: `npm run spec:generate` writes synthetic acceptance checks (reference commonmark oracle; never seeded from official examples).
- **Stage B blind repair**: after visible Stage A, agents see group name + fail count + normative reference only (no IN/EXP/GOT). Harness accepts on **full-suite** monotonic gain — holdout becomes *guided* (not leaked into prompts). Documented honesty boundary.
- **Rung 3 + decompose**: stuck clusters escalate to the strong model; large clusters (>12) get a decomposer pass first.
- **Overfit reviewer**: post-accept diff scan (default: record only; `repair.rejectSuspicious` to hard-reject).
- **Plateau budget**: stop after `plateauRounds` no-gain rounds; wall clock `maxPhaseMinutes` is a backstop (default 240).

Headline results (2026-07-26): repair-only continuations **bare + faithful both 100%** full/visible/holdout (525/525). Fresh faithful e2e reached **93.0%** full / **93.8%** visible / **88.4%** holdout before the 240‑min repair budget skipped Stage B. Faithful stays leaner (3377–3964 LOC vs bare repair 4859). Details in `EXPERIMENTS.md`.

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
docs/references/ Local archive of S-A-008 Cursor blog (fidelity baseline)
tasks/          Parallel task packs (toml-json, sqlite-micro, …) — spec + oracle + prompts
skills/         Agent Skills (SKILL.md standard); swarm-task-pack = pack create + tuning workflow
runs/           Experiment outputs (metrics, logs, tasks)
```

Task packs: **commonmark** (default), **toml-json**, **sqlite-micro** (Tier-1 micro-SQL;
hidden grader via `node:sqlite` differential oracle). To add another, follow the
[swarm-task-pack skill](skills/swarm-task-pack/SKILL.md)
(eligibility gate → hidden oracle → spec → wiring → acceptance). The same skill
also tunes an existing pack after a run plateaus
([pack-tuning](skills/swarm-task-pack/references/pack-tuning.md): failure
autopsy → prose / curation / skeleton fixes). Cursor / Claude Code discover it
automatically via `.cursor/skills/` and `.claude/skills/`.

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
- `visible_score` / `holdout_score` / `holdout_gap_pp` / `overfit_alarm` / `oracle_literal_hits` (v11)
- `repair_clusters` / `adjudications` / `suspected_oracle_bugs` / `phase_cost_curve` / `repair_time_ms` (v11)
- `repair_stage_b` / `overfit_reviews` / `decompositions` / `strong_model_time_ms` / `gen_examples` (v12)
- `resumed` / `resume_segment` when continued via `--resume`; `repair_only` / `from_run` for v12 continuation
- `tasks_done` / per-task status
- lines of code, agent call timing

### Core metrics (v12.1, Cursor 命题四指标)

`core_metrics` in `metrics.json` first-classes the four indicators needed to
reproduce the Cursor swarm economics claim (quality × cost × time):

1. **任务完成率** — `task_completion` (done/total) + `pass_rate_full` / `pass_rate_visible` / `pass_rate_holdout`
2. **单任务完成时间** — `task_time_ms` (mean / median / min / max / total / per_task)
3. **消耗 token** — `tokens` (input / output / cache_read / cache_write, `by_model` + `by_role` breakdown; real counts from the `usage` field of `cursor-agent --output-format json`, not estimates)
4. **总完成时长** — `wall_time_ms` (whole run), `time_to_all_tasks_done_ms` (start → last task done), `agent_time_ms` / `agent_api_time_ms`

Every `agent_calls[]` entry now records `model`, `api_ms`, `tokens_in/out/cache_*`.
`tokens.calls_with_usage` vs `calls_total` shows capture coverage — runs recorded
before v12.1 (text output) rebuild time metrics via `normalizeMetrics` but show
zero token coverage. `npm run preflight:models` prints per-model usage as a
capture self-check; `compare-runs` surfaces the four rows (`task_time` /
`tokens` / `wall_min` / `tasks_done_min`) plus `tokens by model` for the
strong-vs-cheap split.

Each live run also writes `progress.json` (task statuses + phase) for crash recovery, plus `holdout.json` and `ledger.json`.

## Article lineage

Part of @js trilogy: loop → harness → **swarm**. Source blog: Cursor Agent Swarm Model Economics.

## Fidelity boundary (v13 swarm vs S-A-008)

**Source of truth**: Cursor blog *Agent Swarm and Model Economics*
([live URL](https://cursor.com/cn/blog/agent-swarm-model-economics); local archive
[`docs/references/S-A-008-agent-swarm-model-economics.md`](docs/references/S-A-008-agent-swarm-model-economics.md)).
Also registered as **S-A-008** in the sibling x-articles-js project.
Only components **explicitly claimed** in that source are reproduced. Components not in the source
are **not** claimed as Cursor fidelity.

### Reproduced (v13 `npm run swarm`)

| # | Component (S-A-008) | Status in mini-swarm |
|---|---|---|
| 1 | Strong-model planner: tree decompose + delegate; planner never implements; planner owns design decisions | `swarm-planner` (models.strong) writes `DESIGN.md` + `tree.json` actions |
| 2 | Cheap/fast workers execute leaf nodes | `composer-2.5-fast` workers on ready leaves |
| 3 | No fixed topology / scale with complexity | Dynamic task tree (`maxTreeDepth` cap for safety) |
| 4 | Custom high-throughput VCS | **Boundary**: git worktrees + merge queue (not a custom VCS) |
| 5 | Shared design docs + compile-checked references | `DESIGN.md` + `src/contracts.ts` |
| 6 | Neutral third-party merge resolver | `merger` role in MergeQueue |
| 7 | Oversized file: mark → block commit → external split | merge-queue line-count gate → `splitter` (strong) |
| 8 | Cross-scope destructive patches + compiler-driven fix | faithful worktrees + integration-fix on build fail |
| 9 | Multi-perspective low-correlation review stack | `review-diff` / `review-codebase` / `review-spec` (mixed model tiers) |
| 10 | Field Guide folder (`index.md` inject + line budget) | `guide/index.md`; harness serial-appends `guide_note` on main (workers must not edit the file) |
| 11 | Spec-as-prompt; scoring suite **hidden from agents** | **Hidden grader**: agents never see `examples.json` / suite pass-fail / VERIFY_CMD / observe scores. Engineering feedback (build, CLI canary, merge conflicts, reviews, harness checks on **spec-embedded** examples) is required and surfaces via `ACTION_ERRORS` / leaf reports. Scorer remains harness-only observation for experimenters. |
| 12 | Fixed wall-clock budget + metrics | `swarm.budgetMinutes` (default 240) or `--run-to-done` + `maxWallMinutes`; optional `maxTokensInOut` / `--max-tokens` (default unlimited; stops on `tokens_in+tokens_out`, not cache); four core metrics + commits/conflicts/LOC |

**v13.1 parallelism note**: event-driven pipeline (continuous dispatch, async planner/review) raised measured `effective_parallelism` from ~1.3 (v13 batch barrier) to ~6 at concurrency=8. Hundreds of concurrent agents remain a declared boundary (git merge queue serial floor).

**v13.2 anti-interrupt note**: long runs must use `swarm:detached` so the process is not reaped with the IDE terminal. `heartbeat.json` + `metrics.json` checkpoints enable `--resume`; `swarm:finalize` scores a dead run without continuing. Segmented wall time excludes death gaps.

**v13.3 survivability note**: serial Field Guide notes + `guide/index.md merge=union` kill the late-run conflict storm; post-merge CLI canary + observe all-fail redline close 0% windows without leaking suite scores; duplicate planner IDs remap/idempotent instead of wasting rounds.

**Hidden grader vs engineering feedback**: S-A-008 withholds the *scoring* suite from the swarm; it does not withhold compile/runtime/merge reality. Pre-merge build+canary and optional harness self-check on section-embedded examples (`leafHealthRepairAttempts`, `harnessSelfCheckExamples`) feed failures into planner `ACTION_ERRORS`. Suite fail lists and observe rates stay metrics-only. Cross-section embedded sampling (`harnessCrossCheckExamples`, default 5) rejects merges that regress other sections without exposing suite scores.

**Token budget (optional)**: `swarm.maxTokensInOut` / `--max-tokens=N` hard-stops when cumulative `tokens_in+tokens_out` reaches the cap (`stop_reason=token_budget`). Default `null` = unlimited. Cache tokens are not counted. In-flight agents drain before stop (same pattern as wall budget).

**Planner stop policy**: JSON parse failures do **not** share the idle-tree counter (`maxPlannerParseFails` vs `maxUnproductivePlannerRounds`). Recovery retries stay on the configured `swarm-planner` / `json-repair` roles — harness never auto-switches models. Blocked leaves can be harness-requeued (`maxBlockedRescueWaves`) before a true idle stop.

**v13.4 convergence stops** (harness-only; scores never enter agent prompts):

| `stop_reason` | Trigger |
|---|---|
| `observe_perfect` | Observe visible score perfect for `observePerfectStreakToStop` consecutive windows (default **2**; `0` = off) |
| `audit_converged` | All non-waived sections have clean audit count ≥ `auditCleanConvergeThreshold` (default 1), planner still does not declare `done` after `auditConvergedGraceRounds` invites (default **2**; `0` = off) |
| `planner_done` / `idle_tree` / `wall_budget` / `token_budget` | Unchanged |

Audit leaves that target a section with clean ≥ `auditRejectAfterClean` (default 2) are rejected before apply. Coverage injects per-section clean counts and “declare done NOW” when fully converged.

### Long-run ops (v13.2+)

```bash
# Start (detached from Cursor/IDE terminal)
npm run swarm:detached -- --run-id=run-swarm-v13.3 --concurrency=8
# Monitor
#   runs/<id>/console.log
#   runs/<id>/heartbeat.json   # stalls → sync block; stop updating → process dead
#   runs/<id>/metrics.json     # finalized:false while running

# If killed mid-flight (heartbeat stale >2 min):
npm run swarm:resume -- --run-id=run-swarm-v13.3 --concurrency=8

# Or score-only salvage (no more agents):
npm run swarm:finalize -- --run-id=run-swarm-v13.3
```

### Explicitly NOT claimed (absent from S-A-008 raw)

- Persistent planner re-plan loop as a named Cursor feature (we do re-invite the planner with reports for practicality; not marketed as source-text)
- Supervisor that kills stuck agents / auto re-dispatch
- Named Judge acceptance gate
- Swarm-authored tests
- Fixed parallelism N / hundreds of concurrent agents (we keep concurrency ≈ 8; not hundreds)
- 835-page SQL spec scale (we use CommonMark `spec/spec.txt`)

### Legacy pipeline (v8–v12)

`npm run` / `run:contention:*` keep the test-driven linear pipeline
(planner → pool + score feedback → Stage A/B repair) as an **architectural control**.
That path intentionally exposes failing examples to agents and is **not** S-A-008-faithful.

It does **not** reproduce Cursor's custom high-throughput VCS, multiple planner trees, bloated-file decomposition, or stacked multi-perspective review. Results measure this minimal reproduction, not Cursor's production swarm.
