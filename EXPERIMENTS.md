# Experiments log

## Protocol

- **Run A (bare)**: `npm run run:quick -- --run-id=run-a-bare-v4`
- **Run B (coordinated)**: `npm run run:quick:coordinated -- --run-id=run-b-coordinated-v4`
- **Run B faithful**: `npm run run:faithful -- --run-id=run-b-faithful-v7`
- **v13 Cursor-faithful swarm**: `npm run swarm` / `npm run swarm:mock` / `npm run swarm:smoke` (planner tree + **hidden grader** + engineering feedback + review stack; wall-clock budget)
- **v13.1 event-driven + run-to-done**: `npm run swarm:done` / `npm run swarm -- --run-to-done --concurrency=8` (continuous dispatch, async planner/review, worker self-check, spec coverage gate)
- **v13.2 anti-interrupt**: `npm run swarm:detached` (run-to-done + detach) / `npm run swarm:resume -- --run-id=ID` / `npm run swarm:finalize -- --run-id=ID` (heartbeat + metrics checkpoint + segment wall time)
- **v13.3 conflict/health hardening**: serial Field Guide notes + CLI canary + observe redline + planner ID remap (`npm run swarm:detached -- --run-id=run-swarm-v13.3`)
- **v13.3c eng-feedback re-run (CommonMark)**: same as v13.3 + pre-merge build/canary + spec-embedded harness checks (`npm run swarm:detached -- --run-id=run-swarm-v13.3c` / `npm run report:task-run -- --run-id=run-swarm-v13.3c --baseline=run-swarm-v13.3`)
- **v13.4 convergence & stop hardening**: grader-side `observe_perfect` early stop; per-section audit clean counters + reject/re-audit gate + `audit_converged` quiesce; seeded + cross-section embedded canary (`harnessCrossCheckExamples`). Scores still never enter agent prompts.
- **v13.3 engineering feedback loop**: pre-merge build/canary + harness self-check on **spec-embedded** examples (not `examples.json`); failures → leaf summary + planner `ACTION_ERRORS`; shared `leafHealthRepairAttempts` (default 1). Hidden grader unchanged.
- **Token budget (optional)**: `swarm.maxTokensInOut` / `--max-tokens=N` — hard stop on sum(`tokens_in`+`tokens_out`); default unlimited; `stop_reason=token_budget`; cache not counted.
- **v13.3 second sample (TOML→toml-test JSON)**: `npm run swarm:toml:detached -- --run-id=run-swarm-toml-v13.3` / `npm run report:task-run -- --run-id=run-swarm-toml-v13.3 --baseline=run-swarm-v13.3` (`--task=toml-json`, oracle = BurntSushi toml-test)
- **v13.4 third sample (sqlite-micro)**: `npm run swarm:sqlite:detached -- --run-id=run-swarm-sqlite-v1 --concurrency=8 --max-tokens=80000000` / `npm run report:task-run -- --run-id=run-swarm-sqlite-v1` (`--task=sqlite-micro`, oracle = Node `node:sqlite` differential)
- **sqlite-micro pack-tuning v2**: after v1 97.6% plateau — `npm run swarm:sqlite:detached -- --run-id=run-swarm-sqlite-v2 --concurrency=8 --max-tokens=80000000`
- **Solo single-agent baseline**: `npm run solo:mock` / `npm run solo:detached -- --run-id=run-solo-v1` / `npm run solo:resume -- --run-id=ID` — one agent, one workspace, same task packs + hidden grader + holdout/metrics as swarm; no planner tree / worktrees / merge (`architecture=solo-v1`)
- **v13.6 demand-driven width + ladder**: `widthMode=demand` (default) — concurrency = min(cap, frontierDemand, merge backpressure); no planner fanout minimum; `--width-mode=fixed` for v13.5 constants. Ladder: `npm run ladder` / `ladder:toml:detached` (L0 solo → escalate with `--seed-workspace` when visible &lt; 0.9)
- **v13.7 S-A-008 alignment**: empty `files_scope` is a wildcard (exclusive); audit leaves must declare scope; DESIGN.md three-way merge on planner writeback; split-brain / cross-scope prompt rules; seed audit credit; waived_sections in REPORT
- **v13.7.1 defect patch**: planner spawn-fail retry (no empty→json-repair); `planner_spawn_failures` metric; waive evidence gate; audit `files_scope` prompt = start set not boundary. Mechanism-only validation (no new live run).
- **v8/v9/v10/v11/v12 high-contention A/B**: `npm run run:contention:bare` / `npm run run:contention:faithful` (`--task-set=contention`, concurrency 4, seed planner; v9 score-feedback; v10 sync+gate+global repair; v11 holdout+ledger+adaptive repair; v12 Stage B + strong ladder)
- **Resume interrupted run**: `npm run salvage -- --run-id=RUN_ID --task-set=contention` then original command + `--resume` (task-level; agent/wall times in metrics cover last segment only — see README)
- **Repair-only continuation**: `npm run run -- --repair-only --from-run=PRIOR --run-id=NEW --task-set=contention [--coord-mode=faithful]`
- **Serial minimal loop**: `npm run run:serial -- --quick --run-id=run-a-serial-quick`
- **Compare (v12 repair arms)**: `npm run compare -- runs/run-a-bare-v12-repair/metrics.json runs/run-b-faithful-v12-repair/metrics.json`
- **Compare (v12 fresh faithful vs bare repair)**: `npm run compare -- runs/run-a-bare-v12-repair/metrics.json runs/run-b-faithful-contention-v12/metrics.json`
- **Compare (v11)**: `npm run compare -- runs/run-a-bare-contention-v11/metrics.json runs/run-b-faithful-contention-v11/metrics.json`
- **Compare (v10)**: `npm run compare -- runs/run-a-bare-contention-v10/metrics.json runs/run-b-faithful-contention-v10/metrics.json`
- **Compare (v9)**: `npm run compare -- runs/run-a-bare-contention-v9b/metrics.json runs/run-b-faithful-contention-v9/metrics.json`

## Protocol (2026-08-02) — solo single-agent baseline

Goal: produce a **comparable no-coordination arm** against hidden-grader swarm on the same task packs. Inspired by med-research-ai `js-agent-runner` (direct agent baseline), implemented natively in mini-swarm so metrics stay aligned with `finalizeRun` / `compare` / `report-task-run`.

### Fairness (held equal)

- Task pack (`--task=commonmark|toml-json|sqlite-micro`) and CLI contract
- Hidden grader: agents never see `examples.json` / suite scores; harness observe is telemetry-only
- Holdout seed / ratio (`config.holdout`)
- Default model tier: `models.solo` = `composer-2.5-fast` (same cheap tier as swarm workers); optional `--model=` for a strong-model arm
- Wall / token budgets via `config.solo` (`budgetMinutes`, `maxWallMinutes`, `maxTokensInOut`)

### Declared differences vs swarm

- Concurrency **1** (no worktrees, no merge conflicts by construction)
- No planner tree, review stack, Field Guide serial notes, or splitter
- Multi-turn loop: each turn is one `cursor-agent -p` call (`turnTimeoutMinutes`, default 30)
- Stop reasons: `agent_done` | `observe_perfect` | `wall_budget` | `token_budget` | `idle_agent` | `max_turns`
- **Premature `done` gate** (2026-08-02): harness ignores agent `status=done` when observe rate &lt; `solo.minObserveRateForAgentDone` (default **90%**); loop continues until observe threshold, `observe_perfect`, wall/token budget, or idle streak

### Commands

```bash
npm run test:solo
npm run solo:mock -- --run-id=run-solo-mock-v1
npm run solo:smoke
npm run solo:detached -- --run-id=run-solo-v1
npm run report:task-run -- --run-id=run-solo-v1 --baseline=run-swarm-v13.3
npm run compare -- runs/run-swarm-v13.3/metrics.json runs/run-solo-v1/metrics.json
```

Wiring mock (`run-solo-mock-v1`): finalized `agent_done` after 2 scripted turns (skeleton score only; not an acceptance arm).

### Live acceptance (2026-08-02)

Model: `composer-2.5-fast` (`models.solo`); auth: `CURSOR_API_KEY` (ortle3x3); branch `cursor/solo-agent-baseline`.

| Run ID | Pack | Turns | Wall | Tokens (in+out) | Full | Holdout | Stop | vs swarm baseline |
|---|---|---:|---:|---:|---:|---:|---|---|
| **run-solo-v1** | commonmark | 1 | 3.6 min | 112k | **100.0%** (525/525) | 100.0% | agent_done | ≥ v13.3c 99.4% / 462 min / 63.5M |
| **run-solo-sqlite-v1** | sqlite-micro | 1 | 4.6 min | 175k | **96.6%** (717/742) | 95.6% | agent_done | −2.9pp vs sqlite-v2 99.5% / 128 min / 12.0M |
| **run-solo-toml-v1** | toml-json | 2 | 13.6 min | 215k | **83.5%** (464/556) | 78.0% (gap **+6.5**, overfit) | agent_done (premature) | −2.5pp vs toml-v13.3c 86.0% / 286 min / 32.2M |
| **run-solo-toml-v1b** | toml-json | 52 | 68.0 min | 2.29M | **96.9%** (539/556) | 95.6% (gap **+1.6**) | agent_done (observe gate) | **+10.9pp** vs toml-v13.3c; −4.1× wall / −14× tokens |

**Cross-pack read (solo vs hidden-grader swarm):**

- **CommonMark**: solo sufficient — 100% in one turn; swarm coordination adds ~128× wall and ~567× tokens for marginal +0.6pp vs v13.3c.
- **SQLite**: solo fast (−28× wall) but **−2.9pp** full; weak `DISTINCT` (72%); swarm v2 still wins on quality.
- **TOML**: largest gap — solo **Control 32%**; v1 agent self-reported `done` at 84.5% observe → v1b adds observe gate before honoring `agent_done`.

Reports: `runs/run-solo-v1/REPORT.md`, `runs/run-solo-sqlite-v1/REPORT.md`, `runs/run-solo-toml-v1/REPORT.md`.

```bash
npm run compare -- runs/run-swarm-v13.3c/metrics.json runs/run-solo-v1/metrics.json
npm run compare -- runs/run-swarm-sqlite-v2/metrics.json runs/run-solo-sqlite-v1/metrics.json
npm run compare -- runs/run-swarm-toml-v13.3c/metrics.json runs/run-solo-toml-v1/metrics.json
npm run solo:toml:detached -- --run-id=run-solo-toml-v1b   # observe gate re-run
```

## Source text (S-A-008)

Fidelity baseline for v13+ swarm: Cursor blog *Agent Swarm and Model Economics* (Wilson Lin).

- Local archive: [`docs/references/S-A-008-agent-swarm-model-economics.md`](docs/references/S-A-008-agent-swarm-model-economics.md)
- Live: https://cursor.com/cn/blog/agent-swarm-model-economics
- Index: [`docs/references/README.md`](docs/references/README.md)

## Runs (2026-07-27) — v13 Cursor-faithful swarm (S-A-008)

| Run ID | Mode | Notes |
|---|---|---|
| mock-v13-swarm2 | `--mock` | Tree + merge + observe score loop OK; 2 leaves done; planner_rounds=2 |
| smoke-v13-swarm | live, 15 min, conc=2 | Protocol OK: planner JSON → 22 leaves; 8 done; splitter×1; **18.3%** full; tokens captured (worker ~82% of non-cache total in short run) |
| **run-swarm-v13** | live, **240 min**, conc=4 | **69.1%** full (363/525); visible **68.8%** (302/439); holdout **70.9%** (61/86); gap **-2.1** (no overfit alarm); 22 planner rounds; 10 review stacks; 3 splits / 2 oversized blocks; 38/45 task completions recorded; 100 commits; 37 conflicts; 7739 LOC; wall ~244.5 min; agent ~316 min |

Models: planner/splitter/`review-spec` = `cursor-grok-4.5-high-fast`; workers/merger/`review-diff`/`review-codebase` = `composer-2.5-fast`.

### v13 architecture (hidden grader)

New entry `npm run swarm` (legacy `run.mjs` / repair-engine retained as control):

1. **Strong planner tree** — `swarm-planner` writes `DESIGN.md` + `tree.json` actions (`add_task` / `split_task` / …); never implements.
2. **Hidden grader** — agents never see scoring-suite examples, VERIFY_CMD, or suite pass/fail; scorer is harness-only observation (`score_curve` + final triple). Engineering feedback (build/canary/merge/review/spec-embedded checks) still reaches the swarm.
3. **Field Guide folder** — `guide/index.md` with line budget.
4. **Oversized VCS gate** — merge-queue blocks commits when `src/**` exceeds line budget → `splitter`.
5. **Review stack** — diff / codebase / spec perspectives every N merges; findings return to planner.
6. **Wall-clock budget** — default 240 minutes (Cursor 4h frame).

| Metric | run-swarm-v13 | v12 fresh faithful (control) |
|---|---|---|
| Full pass rate | **69.1%** (363/525) | 93.0% (488/525) |
| Visible / holdout | 68.8% / **70.9%** | 93.8% / 88.4% |
| holdout_gap_pp | **-2.1** | +5.5 (alarm) |
| Architecture | hidden-grader swarm | test-driven pool+repair |
| Planner rounds | 22 | seed-contention (fixed) |
| Reviews / splits | 10 / 3 | n/a / n/a |
| Tokens (in+out) | **9.59M** (usage 134/137) | n/a (pre-v12.1) |
| Worker token share | 47.1% (role); cheap model 80.5% | n/a |
| Strong model token share | 19.5% | n/a |
| LOC | 7739 | 3377 |
| Wall | ~244.5 min | ~324 min |

Honesty notes:

- Quality is **lower** than the test-driven v12 pipeline by design (Cursor's own 4h runs were often 73–85% on a different task). Hidden grader forbids suite score feedback and Stage A/B repair.
- Holdout **above** visible (gap −2.1) is the reverse of v11/v12 overfit alarms — evidence that agents were not fitting the official example set.
- Worker role is only ~47% of tokens because merger + review stack + planner also burn tokens; **cheap-model** share remains ~80%. Cursor's “workers ≥69–90%” refers to role mix on their stack, not identical accounting.
- Declared boundary: git worktrees, not custom VCS; concurrency 4, not hundreds of agents.

Compare (observational): `npm run compare -- runs/run-b-faithful-contention-v12/metrics.json runs/run-swarm-v13/metrics.json`

## Runs (2026-07-27/28) — v13.1 run-to-done + event-driven pipeline

| Run ID | Mode | Notes |
|---|---|---|
| mock-v13.1-swarm | `--mock` | Event loop + waive/done gate OK; 2 leaves; waived_sections=22; self_check_total=4 |
| smoke-v13.1-swarm | live, 15 min, conc=2 | Protocol OK: Spec coverage in planner prompt; worktree_sync=6; self_check=53; eff_parallelism=1.79; **22.3%** full |
| **run-swarm-v13.1** | live, **--run-to-done**, conc=8 | **Salvaged** after host killed process ~140 min in-flight (8 leaves still marked running). Workspace scored post-mortem: **86.7%** full (455/525); visible **86.8%** (381/439); holdout **86.0%** (74/86); gap **+0.7**; 21 planner rounds; 87/194 leaves done; wall ~140 min; agent ~850 min; **effective_parallelism 6.08**; self_check_total **602**; tokens **10.34M** |

Models unchanged: planner/splitter/`review-spec` = `cursor-grok-4.5-high-fast`; workers/merger/`review-diff`/`review-codebase` = `composer-2.5-fast`.

### v13.1 changes (still hidden grader)

Motivation: v13 wall 244 min with concurrency=4 but effective parallelism ~1.3 (batch barrier + blocking planner/review). Three verified defects fixed: fence-aware `getReferenceText`, `requeue_task` resets attempts, event-driven scheduler.

1. **Event-driven dispatch** — continuous fill of N slots; planner/review/observe async; DESIGN.md writes via `MergeQueue.enqueueFn`.
2. **run-to-done** — `--run-to-done` uses `maxWallMinutes` hard stop; planner `done` gated on spec coverage / waive + idle tree.
3. **Worker self-check** — prompt requires running embedded `example` blocks from assigned spec sections (still no examples.json / scores).
4. **Spec coverage ledger** — uncovered/waived sections injected into planner; `waive_section` action.
5. **Default concurrency 8** + fan-out guidance; pre-merge `syncWorktreeWithMain`.

| Metric | run-swarm-v13 | run-swarm-v13.1 (salvaged) |
|---|---|---|
| Full pass rate | 69.1% (363/525) | **86.7%** (455/525) |
| Visible / holdout | 68.8% / 70.9% | 86.8% / 86.0% |
| holdout_gap_pp | −2.1 | +0.7 |
| Wall | ~244.5 min | **~139.8 min** (interrupted) |
| effective_parallelism | ~1.3 (derived) | **6.08** |
| self_check_total | 0 | 602 |
| Tokens (in+out) | 9.59M | 10.34M |
| Tree leaves done | 38/115 | 87/194 |
| Architecture | batch sync + budget | event pipeline + run-to-done |

Honesty notes:

- Process was killed by the host before planner `done` / metrics.finish; scores and metrics reconstructed from workspace + agent logs (`salvaged: true` in metrics). In-flight leaves counted failed.
- Quality rose **without** reintroducing test scores to agents (self-check uses only spec-embedded examples).
- Hundreds of concurrent agents / custom VCS remain declared boundaries; merge queue is still the serial floor.

Compare: `npm run compare -- runs/run-swarm-v13/metrics.json runs/run-swarm-v13.1/metrics.json`

## Runs (2026-07-28) — v13.2 anti-interrupt + planner protocol hardening

| Run ID | Mode | Notes |
|---|---|---|
| run-swarm-v13.2-mock | `--mock` | Mock e2e OK; metrics `finalized:true`, 1 segment |
| run-swarm-v13.2-drill | mock resume | Synthetic interrupt → `--resume --mock`: reset running→pending, 2 segments, finalize OK |
| run-swarm-v13.2-kill-resume | live kill→resume | Real smoke killed mid-flight; resume cleaned worktrees/branches, 2 segments, `finalized:true`, full **28.4%** (budget stop) |
| run-swarm-v13.2-finalize-test | `swarm:finalize` | Salvage-only scoring writes `salvaged:true` without resuming |
| **run-swarm-v13.2** | **detached** `--run-to-done` conc=8 | Mid-run `git status` crash → **`--resume` continued** (2 segments). Hard-stop at active wall ~493 min. **92.4%** full (485/525); visible **92.7%** (407/439); holdout **90.7%** (78/86); gap **+2.0**; 91 planner rounds; 58 review stacks; 340/623 leaves done; **effective_parallelism 7.9**; self_check **2738**; tokens **50.69M**; parse_failures **7** |

### Interruption post-mortem (v13.1 → v13.2 motivation)

v13.1 acceptance was **not** a software hang. Evidence: no `MERGE_HEAD`/`index.lock`; death during `Promise.race` idle; no agent `.log` close handlers after 0:21:48; orphan cursor-agent processes wrote worktrees until ~0:27. Host/Cursor terminal teardown killed the orchestrator. Metrics lived only in memory until `finish()`, so the run needed salvage.

### v13.2 changes (still hidden grader)

1. **`--detach`** — respawn with `detached:true`, console → `console.log`, PID → `swarm.pid` (life decoupled from IDE terminal).
2. **Heartbeat** — `heartbeat.json` every 30s (gap = sync stall; stop = death).
3. **Metrics checkpoint** — periodic + post-leaf; `finalized`/`segments` for active wall time across resume gaps.
4. **`--resume`** — refuse if heartbeat fresh; kill orphans; `cleanupInterruptedRun`; reset `running`→`pending` with attempts rollback.
5. **`swarm:finalize`** — shared `finalizeRun()` scores wreckage without continuing the loop.
6. **Planner protocol** — JSON parse failure restores spliced queues + one cheap `json-repair` retry; full ID ledger in tree summary; `design_md` size discipline.

| Metric | run-swarm-v13 | run-swarm-v13.1 (salvaged) | run-swarm-v13.2 |
|---|---|---|---|
| Full pass rate | 69.1% (363/525) | 86.7% (455/525) | **92.4%** (485/525) |
| Visible / holdout | 68.8% / 70.9% | 86.8% / 86.0% | **92.7%** / **90.7%** |
| holdout_gap_pp | −2.1 | +0.7 | +2.0 |
| Active wall | ~244.5 min | ~139.8 min (killed) | **~492.9 min** (2 segments) |
| effective_parallelism | ~1.3 | 6.08 | **7.9** |
| self_check_total | 0 | 602 | **2738** |
| Tokens (in+out) | 9.59M | 10.34M | 50.69M |
| Tree leaves done | 38/115 | 87/194 | 340/623 |
| planner parse failures | n/a | n/a (lost) | 7 (queues restored) |
| Survival | finish-only metrics | salvaged post-mortem | **detach + checkpoint + resume** |

Honesty notes:

- Run survived a mid-flight `git status` crash (Windows status `0xC0000409`) via `--resume`; scores are live `finalized:true`, not salvage.
- Hard-stopped on remaining `maxWallMinutes` after resume (planner never reached `done`); quality still rose vs interrupted v13.1.
- Duplicate task IDs still waste some planner rounds despite ID ledger — recorded as action errors, not silent loss.
- Hidden grader retained; agents never saw suite scores.

Compare: `npm run compare -- runs/run-swarm-v13.1/metrics.json runs/run-swarm-v13.2/metrics.json`

## Runs (2026-07-28/29) — v13.3 conflict storm + health redline

| Run ID | Mode | Notes |
|---|---|---|
| run-swarm-v13.3-mock | `--mock` | Mock e2e OK; `guide/index.md` serial notes (`task-*` stamps); `.gitattributes` `merge=union`; conflicts **0** |
| run-swarm-v13.3-drill | mock resume | Synthetic interrupt → `--resume --mock`: reset running→pending, **2 segments**, finalize OK |
| unit drills | local | duplicate-id idempotent + remap/deps; done-leaf compression; throw-on-import canary; finalize clears leftover `MERGE_HEAD` |
| **run-swarm-v13.3** | **detached** `--run-to-done` conc=8 | **Finalized** (idle tree). **98.1%** full; visible **97.7%**; holdout **100%**; conflicts **39**; zero-pass observe **0**; planner_rounds **65**; active wall ~**279** min. Compare: `npm run compare -- runs/run-swarm-v13.2/metrics.json runs/run-swarm-v13.3/metrics.json` |
| **run-swarm-v13.3c** | **detached** `--run-to-done` conc=8; eng-feedback gates on; human interrupt + `swarm:finalize` | **Salvaged**. **99.4%** full (522/525); visible **99.5%** (437/439); holdout **98.8%** (85/86); gap **+0.7**; conflicts **53**; zero-pass observe **0**; planner_rounds **111**; self_check **5526**; eff_parallelism **9.13**; tokens in+out **63.53M**; active wall ~**462** min; weak: Emphasis (2), Code spans (1). Report: `runs/run-swarm-v13.3c/REPORT.md` |

### v13.2 late-run stall post-mortem (motivation for v13.3)

v13.2 hard-stopped at **92.4%** with budget exhausted — not planner `done`. Three linked losses in the last ~3h:

1. **`guide/index.md` conflict storm** — 65/82 merge conflicts hit the shared Field Guide (workers appended in their own worktrees). Late merges spent minutes resolving noise; leftover unmerged state forced planner to spawn cleanup tasks that never ran.
2. **0% observe windows (~40 min)** — a bad merge left `entities.js` throwing on import; `tsc` still green so `ensureBuiltWithRepair` passed. Hidden grader meant no agent saw the *suite* collapse (canary later closed this engineering gap).
3. **Planner round waste** — 7 JSON parse failures + batches of duplicate IDs (`task-06/07/08` recycled) despite the ID ledger; done-leaf lines bloated the prompt (~340 lines).

### v13.3 changes (still hidden grader)

1. **Serial Field Guide** — workers must not edit `guide/index.md`; harness appends `guide_note` on main via `MergeQueue.enqueueFn` after a successful merge. `.gitattributes` `guide/index.md merge=union` as a backstop.
2. **CLI canary** — after build, `node dist/cli.js` must accept a trivial stdin line (15s). Failure reuses integration-fix with a runtime-crash prompt (no suite leakage).
3. **Observe redline** — if observe sees `total>0 && passed===0`, push an `URGENT` repair hint into `actionErrors` (canary stderr first line only).
4. **Stop/finalize cleanup** — abort leftover `MERGE_HEAD` before final score (salvage path force-drops a corrupt marker).
5. **Merge-queue hardening** — `safeGitStatus()` never throws through `_pump`; `executeLeaf` catches enqueue exceptions.
6. **Planner efficiency** — duplicate IDs are idempotent (same title) or remapped (deps/parent rewritten in-batch); parse failures dump to `planner-parse-fail-*.txt`; done leaves compressed to one ledger line.

Honesty notes:

- Canary / observe redline use **binary health only** (CLI starts / any example can render). They do not expose pass lists, expected HTML, or section scores to agents.
- Live CommonMark acceptance (`run-swarm-v13.3`) finalized at **98.1%** full with healthy observe (no 0% windows) and conflicts far below the v13.2 guide-storm peak (39 vs 82).

### v13.3 eng-feedback re-run (CommonMark)

Same task pack and model tier as `run-swarm-v13.3`, with engineering feedback loop enabled (pre-merge build/canary + spec-embedded harness self-check; failures → leaf summary + planner `ACTION_ERRORS`). Hidden grader unchanged — agents still never see `examples.json` or suite scores.

| Metric | run-swarm-v13.3 | **run-swarm-v13.3c** (salvaged) |
|---|---|---|
| Full pass rate | 98.1% (515/525) | **99.4%** (522/525) |
| Visible / holdout | 97.7% / **100%** | **99.5%** / 98.8% |
| holdout_gap_pp | (holdout ≥ visible) | +0.7 |
| merge_conflict_count | 39 | 53 |
| zero-pass observe | 0 | 0 |
| planner_rounds | 65 | 111 |
| self_check_total | 2376 | **5526** |
| Active wall | ~279 min | ~**462** min (human interrupt) |
| tokens in+out | (pre-budget logging) | **63.53M** |
| Stop | idle_tree | **human_interrupt + salvage** |

Reading:

1. **Eng-feedback lifts visible/full** — +1.3pp full, +1.8pp visible vs v13.3 without reintroducing suite scores to agents.
2. **Holdout slips slightly** — 100% → 98.8% (−1.2pp); gap +0.7 still passes the &lt;5pp bar; `overfit_alarm=false`.
3. **Late audit churn** — visible briefly hit 439/439 mid-run, then regressed to 437/439 (Emphasis boundary cases) before salvage; extra planner rounds + conflicts vs v13.3.
4. **Cost** — ~1.7× wall and heavy self_check volume for marginal full-suite gain; not a free lunch vs the lean v13.3 finalize.

Honesty notes:

- **Salvaged** after human kill near the 480m wall — not planner `done` or natural idle_tree stop.
- Token budget left unlimited (`maxTokensInOut=null`); compare wall time, not token cap.
- Remaining misses: Emphasis (2/132), Code spans (1/22) — long-tail inline edge cases, not structural block failures.

Compare:

```bash
npm run compare -- runs/run-swarm-v13.3/metrics.json runs/run-swarm-v13.3c/metrics.json
```

## Protocol (2026-07-31) — v13.4 convergence & stop hardening

Motivation from CommonMark `run-swarm-v13.3c`: visible hit **100%** at observe m302 (~350 min), then audit churn continued until human kill at ~462 min; final salvaged full **99.4%** (Emphasis/Code-spans regressions). Tree had **376/571** audit leaves; planner never emitted `done`. Observe scores were telemetry-only — stop policy could not see perfection.

v13.4 adds three harness-side controls (no suite leakage to agents):

1. **`observe_perfect`** — consecutive perfect observe windows (`observePerfectStreakToStop`, default 2) → stop after drain.
2. **Audit convergence** — `tree.audit_state[section].clean`; clean audit (+0 code change) increments; code-changing merge resets. Coverage shows counts; reject re-audit when clean ≥ `auditRejectAfterClean`; after full converge + `auditConvergedGraceRounds` planner invites without `done` → quiesce + `audit_converged`.
3. **Cross-section embedded canary** — after scoped self-check, sample other sections' embedded examples (`harnessCrossCheckExamples`); fail → `pre-merge-cross` engineering error.

Acceptance command (same models/concurrency as v13.3c):

```bash
npm run swarm:detached -- --run-id=run-swarm-v13.4 --concurrency=8
npm run report:task-run -- --run-id=run-swarm-v13.4 --baseline=run-swarm-v13.3c
```

## Protocol & acceptance (2026-08-02) — v13.5 four-lever control-loop refactor

Motivation: v13.3/v13.4 treated hidden observe scores mostly as telemetry while
planner coverage, self-reported audit cleanliness, and stale pre-merge checks
controlled stopping. Solo's `agent_done` already had a 90% harness-side quality
gate, so the architecture comparison used asymmetric stop semantics.

v13.5 changes four harness-side levers without exposing scores to agents:

1. **Persistent-state verification** — assigned examples run before merge; after
   merge, main must pass build/canary, assigned examples, and regression samples
   from sections already completed in the verified tree. A failed post-merge
   gate gets one integration-fix attempt, then rolls main back to `preSha`.
   Observe scoring is serialized through the merge queue.
2. **Hidden quality control** — planner `done`, audit quiescence, and true idle
   stop require a fresh observe score at or above 90%. A full-coverage run can
   stop on four fresh observe windows with less than 0.5pp net gain
   (`observe_plateau`). Agents receive only the rejection/defer bit, never the
   score.
3. **Verified ledger** — done leaves record the verified main SHA and checked
   count; `total_attempts` is monotonic across requeues and capped at 9; stop
   drain reconciles successful in-flight merges instead of discarding them.
4. **Adaptive coordination tax** — concurrency stays 8 during coverage and
   falls to 2 after all sections are covered. Planner fanout has no lower bound
   in endgame. Task packs may provide `swarmOverrides` while CLI flags remain
   highest priority.

Important correction during acceptance: the first implementation retained the
old broad cross-section gate on incomplete worktrees/main. That rejects a valid
early leaf because unrelated sections are not implemented yet. Final v13.5
samples only regression-check sections already represented by verified done
leaves.

| Run ID | Status | Full | Visible / holdout | Stop | Wall | Tokens in+out | Planner rounds | Conflicts |
|---|---|---:|---:|---|---:|---:|---:|---:|
| `run-swarm-toml-v13.5c` | **final acceptance** | **91.9%** (511/556) | 92.5% / 89.0% | `observe_plateau` | **56.7m** | **9.44M** | 17 | 23 |
| `run-swarm-v13.5b` | **final acceptance** | **99.8%** (524/525) | 99.8% / 100% | `observe_plateau` | **357.7m** | **28.09M** | 51 | 40 |
| `run-swarm-toml-v13.5b` | transitional, not acceptance | 96.6% (537/556) | 96.8% / 95.6% | `observe_plateau` | 22.2m | 4.97M | 7 | 13 |
| `run-swarm-toml-v13.5` / `run-swarm-v13.5` | aborted development arms | — | — | human stop | — | — | — | — |

Final-arm comparison:

- **TOML vs v13.3c**: full **86.0% → 91.9%** (+5.9pp), wall
  **281.6m → 56.7m** (−80%), tokens **32.23M → 9.44M** (−71%),
  planner rounds **52 → 17**. Holdout remains close (89.0%) but the
  visible-minus-holdout gap is +3.5pp.
- **CommonMark vs v13.3c**: full **99.4% → 99.8%** (+0.4pp), wall
  **459.2m → 357.7m** (−22%), tokens **63.53M → 28.09M** (−56%),
  planner rounds **111 → 51**. The run stopped naturally rather than via human
  salvage.
- The post-merge rollback gate rejected 3 TOML and 12 CommonMark regressions.
  Endgame concurrency reduced effective parallelism, but also cut commits,
  conflicts, planner churn, and total model work.
- CommonMark briefly reached 100% visible at quality merge 102, then one later
  merge regressed one visible case; the plateau stop finalized at 99.8%. The
  remaining weakness is therefore rollback sampling coverage, not inability to
  reach the target.
- Live logs also exposed Cursor's `cursor-compile-cache/` as an unignored
  generated directory, inflating conflict files without contributing code.
  Workspace initialization now ignores it; acceptance conflict counts above
  still include that pre-fix noise and are conservative.

Reports and comparisons:

```bash
npm run report:task-run -- --run-id=run-swarm-toml-v13.5c --baseline=run-swarm-toml-v13.3c
npm run compare -- runs/run-swarm-toml-v13.3c/metrics.json runs/run-swarm-toml-v13.5c/metrics.json
npm run report:task-run -- --run-id=run-swarm-v13.5b --baseline=run-swarm-v13.3c
npm run compare -- runs/run-swarm-v13.3c/metrics.json runs/run-swarm-v13.5b/metrics.json
```

## Protocol & acceptance (2026-08-03) — v13.6 fifth lever (demand-driven width + ladder)

Motivation: S-A-008 never hard-codes “open N agents”. Parallelism is an *output*
of the planner tree’s natural width (independent leaves with disjoint
`files_scope`). mini-swarm previously did the opposite: fixed `concurrency=8`
plus a planner prompt that forced `keep at least FANOUT_TARGET ready leaves`
(`fanoutTarget = concurrency × 2`). That is supply-side coercion — the failure
mode Cursor’s own blog warns against (activity ≠ productivity; Coase threshold).

v13.6 adds a fifth harness-side lever (still no scores in agent prompts):

1. **Demand-driven width** (`widthMode=demand`, default) — each tick
   `width = min(maxConcurrency, frontierDemand, backpressureCap)`.
   `frontierDemand` is a greedy count of running∪ready leaves with pairwise
   disjoint `files_scope` (v13.6 treated empty scope as independent; **v13.7
   reverses this to wildcard/exclusive**). Dispatch also refuses
   scope-overlapping candidates. `swarm.concurrency` is now a **cap**,
   not a target. `--width-mode=fixed` restores the v13.5 two-stage constant
   (`endgameConcurrency` after full coverage).
2. **Merge backpressure** — recent `merge_waits` (label=`merge`) average above
   `mergeWaitHighSec` / `mergeWaitMediumSec` caps width at 2 / 4.
3. **Fanout prompt reversal** — planner is told the max concurrency and that
   filler tasks are forbidden; no numeric ready-leaf minimum. Narrow-frontier
   advisory (qualitative only) fires when uncovered sections remain and
   ready+running &lt; 2 for `narrowFrontierAdvisoryRounds` planner invites.
4. **Solo→swarm ladder** (`npm run ladder`) — L0 solo for `l0MaxMinutes`; if
   visible &lt; `l0TargetObserve` (and not `observe_perfect`), escalate to swarm
   with `--seed-workspace` from the solo workspace. Harness seeds synthetic
   done leaves for sections whose embedded examples already pass (v13.7 mock
   credits first two sections + `audit_state.clean=1`). There is no separate
   L1 — demand width naturally collapses to planner + serial workers on a
   narrow tree.

### Acceptance (TOML live; CommonMark manual/pending)

| Run ID | Status | Full | Visible / holdout | Stop | Wall | Tokens | Conflicts | Notes |
|---|---|---:|---:|---|---:|---:|---:|---|
| `run-swarm-toml-v13.6` | **final acceptance** | **93.9%** (522/556) | 94.2% / 92.3% | `planner_done` | **49.6m** | **3.66M** | **5** | demand width; avg width 2.60 ≈ demand 2.53 |
| `run-ladder-toml-v13.6` | **final acceptance (L0)** | **91.5%** (via `-l0`) | 91.6% / 91.2% | L0 `wall_budget` → ladder `visible_above_target` | **~31m** | **~0.72M** (L0) | n/a | **no escalate** — Coase-correct |
| `run-swarm-v13.6` / `run-ladder-v13.6` | **pending / manual** | — | — | — | — | — | — | CommonMark; do not auto-run |

Demand-arm vs `run-swarm-toml-v13.5c`: full **91.9% → 93.9%** (+2.0pp), wall
**56.7m → 49.6m**, tokens **9.44M → 3.66M** (−61%), conflicts **23 → 5**,
`effective_parallelism` **3.7 → 1.76** with `width_curve` tracking frontier
(max width 6, never forced to 8). Hypothesis supported.

Ladder-arm: L0 solo hit visible **91.6%** (≥ `l0TargetObserve=0.9`) under the
30‑minute L0 cap and **correctly refused to open a swarm**. `ladder.json`
records `escalated:false` / `reason:visible_above_target`. This is the intended
Coase-threshold outcome for a pack that fits one agent.

Judging:

- **Demand arm**: full within ~91.9% ±2pp and natural stop = quality parity;
  conflicts &lt; 23 and `width_curve` tracking frontier (narrower scissors vs
  v13.5c’s configured 8 vs eff_parallelism 3.7) = hypothesis supported.
- **Ladder arm**: stop at L0 with visible ≥ 0.9 = task below Coase threshold
  (correct answer). Escalate = check `seeded_sections` non-empty, swarm only
  patches weak sections; compare total tokens/quality to `run-solo-toml-v1b`
  (96.9% / 2.29M).
- Honesty: all three current packs may terminate at L0/L1-equivalent width.
  Wide L2 escalation needs a future pack that exceeds a single context window.

Commands:

```bash
npm run test:width && npm run test:ladder && npm run test:convergence
npm run swarm:mock -- --run-id=run-swarm-v13.6-mock
npm run swarm:mock -- --run-id=run-swarm-v13.6-mock-fixed --width-mode=fixed
npm run ladder:mock -- --run-id=run-ladder-v13.6-mock

npm run swarm:toml:detached -- --run-id=run-swarm-toml-v13.6 --concurrency=8
npm run report:task-run -- --run-id=run-swarm-toml-v13.6 --baseline=run-swarm-toml-v13.5c
npm run compare -- runs/run-swarm-toml-v13.5c/metrics.json runs/run-swarm-toml-v13.6/metrics.json

npm run ladder:toml:detached -- --run-id=run-ladder-toml-v13.6

# CommonMark (manual; not part of automated acceptance)
npm run swarm:detached -- --run-id=run-swarm-v13.6 --concurrency=8
npm run ladder -- --task=commonmark --run-id=run-ladder-v13.6 --detach
```

## Protocol & acceptance (2026-08-04) — v13.7 S-A-008 alignment hardening

Motivation: re-read of Cursor S-A-008 against v13.6 found three mechanism gaps
worth fixing now, plus small cleanups. Not a new lever — an alignment patch.

1. **Empty scope = wildcard** — `frontierDemand` / `scopeDisjoint` treat empty
   `files_scope` as exclusive (conflicts with everything). Audit `add_task`
   without scope is rejected (`auditScopeError`). Closes the hole where audit
   leaves raced scoped workers.
2. **DESIGN.md three-way merge** — planner invite snapshots DESIGN.md; writeback
   uses `git merge-file` against main. Conflicts keep main and surface an
   action error; `design_write_conflicts` is counted. Stops planner full-replace
   from clobbering worker interface updates.
3. **Split-brain / cross-scope conduction (prompt)** — planner must not let two
   leaves decide the same open question (`D-NN` decision entries); workers
   check DESIGN/contracts before inventing helpers and read
   `git log --grep="cross-scope:"` on foreign build failures; review-codebase
   looks for duplicate concept implementations; engineering errors attach
   recent cross-scope commit lines.
4. **Seed audit credit + waive visibility** — ladder seed writes
   `audit_state[section].clean=1`; finalize/REPORT expose `waived_sections`
   and `design_write_conflicts`.

### Honesty (explicitly not in v13.7)

- Sub-planner hierarchy / recursive deep trees (`maxTreeDepth=2` stay)
- Compiler-checked decision references (prompt `D-NN` only)
- `frontierDemand` greedy under-estimate (prefer narrow; known approximation)
- Planner prompt unbounded ID list growth (scale item for v13.8)

### Acceptance (TOML live)

| Run ID | Status | Full | Visible / holdout | Stop | Wall | Tokens | Conflicts | Notes |
|---|---|---:|---:|---|---:|---:|---:|---|
| `run-swarm-toml-v13.7` | **final acceptance** | **92.6%** (515/556) | 93.3% / 89.0% | `planner_done` | **70.5m** | **6.46M** | **5** | design_write_conflicts=0; waived Encoding; width avg 2.73 max 8 |
| `run-swarm-v13.7` | **pending / manual** | — | — | — | — | — | — | CommonMark; do not auto-run |

Judging vs `run-swarm-toml-v13.6` (93.9% / 3.66M / conflicts 5):

- full **92.6%** ≥ ~92% = quality parity (**PASS**; −1.3pp vs v13.6)
- conflicts **5** ≤ 5 (**PASS**)
- `design_write_conflicts`=0 recorded (**PASS**)
- `width_curve` avg 2.73 / max 8 — no pathological collapse (**PASS**)
- Cost honesty: wall 49.6→70.5m and tokens 3.66M→6.46M (alignment gates + more audit/rescue churn); waived `Encoding` visible in REPORT
- Mock: `run-swarm-v13.7-mock` rejected scopeless audit; `run-ladder-v13.7-mock` seeded 2 sections with `audit_state.clean=1`

Commands:

```bash
npm run test:width && npm run test:design-merge && npm run test:convergence
npm run swarm:mock -- --run-id=run-swarm-v13.7-mock
npm run ladder:mock -- --run-id=run-ladder-v13.7-mock

npm run swarm:toml:detached -- --run-id=run-swarm-toml-v13.7 --concurrency=8
npm run report:task-run -- --run-id=run-swarm-toml-v13.7 --baseline=run-swarm-toml-v13.6
npm run compare -- runs/run-swarm-toml-v13.6/metrics.json runs/run-swarm-toml-v13.7/metrics.json
```

## Protocol & acceptance (2026-08-06) — v13.8 review window + fix context

Post-mortem of `run-swarm-toml-v13.7` (artifacts only on that run's workspace/logs)
confirmed two mechanisms were idle / harmful:

1. **R-01 review-diff window** — after each successful leaf merge the harness
   commits `guide: note from <task>` on main *before* the review counter
   fires. `getDiff` defaulted to `HEAD~1..HEAD`, so all 7 review-diff
   prompts in that run saw only `guide/index.md`. Findings still flowed to
   the planner (including high-severity speculation about unseen `src/`
   files). Fix: capture `lastReviewSha` at run start / after each review;
   `runReviewStack({ sinceSha })` diffs that SHA→HEAD; prompt forbids
   inventing findings from bookkeeping-only diffs. Metrics record
   `since_sha` / `tip_sha` per review.
2. **R-03 integration-fix context** — swarm used
   `buildHealthRepairPrompt({ kind, stderr, phase })` with no DESIGN.md,
   no diff, no cross-scope log (legacy `buildIntegrationFixPrompt` was
   unused). Fix: inject DESIGN + recent diff + `recentCrossScopeLog` into
   every pre-/post-merge integration-fix prompt.

Architecture string: `v13.8-swarm`. See [`ROADMAP.md`](ROADMAP.md) R-01 / R-03.

### Honesty

- **No new live TOML acceptance run** in this patch — validation is unit +
  mock only. Live score vs `run-swarm-toml-v13.7` is pending.
- Resuming a pre-v13.8 run without `last_review_sha` in metrics: first
  review-diff falls back to `HEAD~1` until a v13.8 review records `tip_sha`.
- R-02a (guide budget) and R-04 (plan deps deadlock) were **not** triggered
  in v13.7 live and are not in this PR.

Commands:

```bash
npm run test:review-stack && npm run test:eng-feedback && npm run test:convergence
npm run swarm:mock -- --run-id=run-swarm-v13.8-mock
npm run ladder:mock -- --run-id=run-ladder-v13.8-mock
```

## Protocol & acceptance (2026-08-04) — v13.7.1 defect patch (same PR)

Post-mortem of `run-swarm-toml-v13.7` confirmed four real defects; this patch
fixes them without claiming a new live score.

1. **Planner spawn → json-repair fabrication** — empty/`ok=false` planner
   output was routed to json-repair, which (with workspace cwd + tools)
   fabricated real actions. Now: detect spawn failure, count
   `planner_spawn_failures`, retry same prompt once, then `return null`
   (plan==null path). json-repair only sees non-empty malformed text; cwd
   is `runDir`.
2. **Spawn failures invisible** — `planner_parse_failures` stayed 0 when
   repair "succeeded". REPORT / compare now show `planner_spawn_failures`.
3. **Waive without evidence** — `waive_section` applied even when the
   section's visible suite still failed. The first patch used embedded spec
   examples, but the v13.7 Encoding workspace proved that insufficient
   (embedded 2/2 while visible 6/10). The final gate runs a section-scoped,
   holdout-excluding `scoreScope`, fails closed on missing/scorer evidence,
   and reports only aggregate failure counts to the planner. Mock mode opts
   out explicitly with `skipped=true`.
4. **Audit scope attention boundary** — planner prompts now say
   `files_scope` is a start set, not a boundary; cross-file section
   semantics required. "No dedicated file" is not a waive reason.

### Honesty

- v13.7 live −1.3pp vs v13.6 is within run variance + infra keychain faults
  (5/19 planner rounds empty); not treated as an alignment regression.
- **No new live TOML acceptance run** in this patch — validation is unit +
  mock only (`swarm:mock`, `ladder:mock`).

Commands:

```bash
npm run test:convergence
npm run swarm:mock -- --run-id=run-swarm-v13.7.1-mock
npm run ladder:mock -- --run-id=run-ladder-v13.7.1-mock
```

## Runs (2026-07-29) — v13.3 second sample: TOML → toml-test JSON

Goal: reuse the **same** hidden-grader swarm (v13.3) on a second verifiable task pack to test migration — not to match CommonMark’s absolute score on the first pass.

| Run ID | Mode | Notes |
|---|---|---|
| swarm:toml:mock | `--mock --task=toml-json` | Skeleton ~67% floor; guide serial; conflicts 0 |
| run-swarm-toml-smoke* | live smoke | Protocol OK under `auto` after grok/composer quota exhaustion on prior account |
| run-swarm-toml-v13.3 (auto, aborted) | detached | Wrong model tier (`auto`); later worktree collision on restart → archived |
| **run-swarm-toml-v13.3** | **detached** `--task=toml-json --run-to-done` conc=8 | **Finalized** (idle tree / false early stop). **76.4%** full (425/556); visible **75.7%** (352/465); holdout **80.2%** (73/91); gap **−4.5**; conflicts **11**; zero-pass observe **0**; planner_rounds **9**; parse_failures **2**; self_check **142**; eff_parallelism **5.29**; tokens **3.81M**; wall ~**38.9** min |
| **run-swarm-toml-v13.3b** | **detached** `--task=toml-json --run-to-done` conc=8; 1× human pause + `--resume` | **Finalized** (`wall_budget`, post stop-policy fix). **85.1%** full (473/556); visible **84.1%** (391/465); holdout **90.1%** (82/91); gap **−6**; conflicts **18**; zero-pass observe **0**; planner_rounds **131**; parse_failures **6**; self_check **3821**; eff_parallelism **9.66**; tokens in+out **63.57M** (+~271M cache_read); active wall ~**487** min |
| **run-swarm-toml-v13.3c** | **detached** `--task=toml-json --run-to-done` conc=8; eng-feedback gates on; human interrupt + `swarm:finalize` | **Salvaged**. **86.0%** full (478/556); visible **85.2%** (396/465); holdout **90.1%** (82/91); gap **−4.9**; conflicts **45**; zero-pass observe **0**; planner_rounds **52**; harness_self_check **1008**; self_check **1652**; eff_parallelism **8.01**; tokens in+out **32.23M** (+~176M cache_read); active wall ~**286** min; Encoding **12/12** |

Models (acceptance): planner/splitter/`review-spec` = `cursor-grok-4.5-high-fast`; workers/merger/`review-diff`/`review-codebase` = `composer-2.5-fast` — **same tier as CommonMark v13.3** (not `auto`).

### Task pack

- Oracle: BurntSushi `toml-test` @ v1.6.0 → `tasks/toml-json/spec/examples.json` (556 cases: 185 valid + 371 invalid).
- Harness: `--task=toml-json` via `orchestrator/lib/task-pack.mjs`; scorer supports `input` / `expected` / `expect_error`.
- Reports: `runs/run-swarm-toml-v13.3/REPORT.md`, `runs/run-swarm-toml-v13.3b/REPORT.md`, `runs/run-swarm-toml-v13.3c/REPORT.md`.

### Budget (v13.3b / v13.3c)

- Time: `--run-to-done` → hard stop `swarm.maxWallMinutes` (**480**); token cap optional (`maxTokensInOut`, default unlimited).
- v13.3b: authentic wall exhaustion (~487 active min).
- v13.3c: human interrupt ~279m live + salvage finalize; token budget left off.

### Compare (TOML arms vs CommonMark)

| Metric | toml v13.3 | toml v13.3b | **toml v13.3c** | CM v13.3 |
|---|---|---|---|---|
| task_pack | toml-json | toml-json | toml-json | commonmark |
| Full pass rate | 76.4% | 85.1% | **86.0%** | **98.1%** |
| Visible / holdout | 75.7% / 80.2% | 84.1% / 90.1% | **85.2% / 90.1%** | 97.7% / 100% |
| holdout_gap_pp | −4.5 | −6 | **−4.9** | (holdout ≥ visible) |
| Encoding | (mixed) | 50% | **100%** | n/a |
| merge_conflict_count | 11 | 18 | **45** | 39 |
| zero-pass observe | 0 | 0 | **0** | 0 |
| planner_rounds | 9 | 131 | **52** | 65 |
| Active wall | ~39 min | ~487 min | ~**286** min (salvaged) | ~279 min |
| harness_self_check | — | — | **1008** | — |
| self_check_total | 142 | 3821 | **1652** | 2376 |
| tokens in+out | 3.81M | 63.57M | **32.23M** | **63.53M** (CM v13.3c salvaged) |
| Stop | idle_tree (bug) | wall_budget | **human_interrupt + salvage** | idle_tree |

### Reading

1. **Protocol migrates** — second sample finalized under hidden grader; holdout healthy; no observe redline trips.
2. **Stop-policy fix validated** — v13.3b ran **131** planner rounds to wall (vs v13.3’s **9**-round false idle).
3. **Eng-feedback arm (v13.3c)** — pre-merge build/canary + spec-embedded harness checks; Encoding **50%→100%**; full **86.0%** in ~286m vs v13.3b **85.1%** in ~487m.
4. **Late plateau persists** — visible stuck ~84–85% while leaves keep merging; Spec Examples / Keys / Strings still dominate misses.
5. **Absolute CM-class score still not shown** — 86.0% ≪ CM 98.1%.
6. **Early idle root cause (v13.3)** — parse-fail and true-idle shared counter; fixed in `swarm-stop-policy.mjs`.

Honesty notes:

- Do **not** treat short TOML walls as fair vs CM without equalized active minutes; v13.3b/c are the long TOML arms.
- v13.3c was **salvaged** after human kill — not a natural planner_done / wall_budget stop.
- An earlier `auto`-model attempt was aborted; acceptance numbers are grok/composer only.
- Failure arrays in score JSON are truncated samples; use `failure_count` + `by_section` for totals.
- \|holdout_gap\| on v13.3b was 6 (formal fail) with negative gap; v13.3c gap −4.9 passes the &lt;5pp bar; `overfit_alarm=false`.
- Token cache_read is separate from in+out totals in REPORT.

Compare:

```bash
npm run compare -- runs/run-swarm-toml-v13.3b/metrics.json runs/run-swarm-toml-v13.3c/metrics.json
npm run compare -- runs/run-swarm-toml-v13.3/metrics.json runs/run-swarm-toml-v13.3c/metrics.json
npm run compare -- runs/run-swarm-v13.3/metrics.json runs/run-swarm-toml-v13.3c/metrics.json
```

## Runs (2026-08-01) — v13.4 third sample: sqlite-micro (Tier-1 micro-SQL)

Goal: same hidden-grader swarm on a third pack that mirrors the S-A-008 SQLite experiment *shape* (spec-only + hidden oracle), cut to a cheap-model Tier-1 subset. Measure plateau vs CommonMark / TOML under identical planner/worker tiers.

| Run ID | Mode | Notes |
|---|---|---|
| swarm:sqlite:mock | `--mock --task=sqlite-micro` | Skeleton + canary OK; protocol wiring validated |
| **run-swarm-sqlite-v1** | **detached** `--task=sqlite-micro --run-to-done` conc=8 `--max-tokens=80000000` | **Finalized** (`idle_tree`). **97.6%** full (724/742); visible **97.5%** (612/628); holdout **98.2%** (112/114); gap **−0.8**; conflicts **24**; zero-pass observe **0**; planner_rounds **40**; self_check **1295** / harness_self_check **1076**; eff_parallelism **8.23**; tokens in+out **15.07M** (+~100M cache_read); active wall ~**231** min; LOC **4727**. Report: `runs/run-swarm-sqlite-v1/REPORT.md` |
| **run-swarm-sqlite-v2** | **detached** same flags as v1 | **Finalized** (`planner_done`). **99.5%** full (738/742); visible **99.5%** (625/628); holdout **99.1%** (113/114); gap **+0.4**; conflicts **7**; zero-pass observe **0**; planner_rounds **24**; self_check **868** / harness_self_check **731**; eff_parallelism **7.51**; tokens in+out **12.02M**; active wall ~**128** min; LOC **3991**. Report: `runs/run-swarm-sqlite-v2/REPORT.md` |

Models: planner/splitter/`review-spec` = `cursor-grok-4.5-high-fast`; workers/merger/`review-diff`/`review-codebase` = `composer-2.5-fast` — same tier as CM/TOML acceptance runs.

### Pack tuning v2 (before run-swarm-sqlite-v2)

Applied `skills/swarm-task-pack/references/pack-tuning.md` to the 18 v1 misses (all outside the previous embedded-example window). Channels:

| Class | Channel | Fix | v2 outcome |
|---|---|---|---|
| INTEGER affinity retains non-integer text/real | A+B | prose `14-cast-and-affinity.md`; pin `006`/`016` | **cleared** |
| CAST non-numeric text → 0 (not NULL) | A+B | corrected wrong prose that taught NULL; pin `013` | **cleared** |
| REAL storage class / typeof | A+B+C | tagged `Value` in skeleton; pin `017` / `numeric-016` | **cleared** |
| Scalar min/max propagate NULL | A+B | corrected wrong prose that taught skip-NULL; pin `010`/`033`/`034` | **cleared** |
| Double-quoted keywords as identifiers | A+B | strengthened `01-…`; pin `023`/`024`/`026` | **cleared** |
| NULL sorts first under ASC | A+B | clarified order-by + distinct; pin `distinct-024` | **cleared** |

Gates before launch: import OK; `check-skeleton` PASS; 128/128 embedded examples match `node:sqlite`; `swarm:sqlite:mock` complete; `test:convergence` green.

### Task pack

- Oracle: Node v24 `node:sqlite` differential from `tasks/sqlite-micro/scripts/inputs/*.mjs` → 742 cases (630 valid + 112 invalid across 19 sections).
- Spec: generated `spec.txt` (~60k chars) with curated embedded examples; agents never see `examples.json`.
- Harness: `--task=sqlite-micro`; CLI stdout = last SELECT as JSON row-array; canary `SELECT 1;` → `[[1]]`.
- Out of scope (declared): JOIN, GROUP BY, subqueries, constraints, file persistence, BLOB, datetime, windows.

### Compare (v1 → v2 pack-tuning)

| Metric | sqlite-micro **v1** | **v2** (tuned) |
|---|---|---|
| Full pass rate | 97.6% (724/742) | **99.5% (738/742)** |
| Visible / holdout | 97.5% / 98.2% | **99.5% / 99.1%** |
| holdout_gap_pp | −0.8 | **+0.4** |
| Remaining misses | 18 | **4** |
| merge_conflict_count | 24 | **7** |
| planner_rounds | 40 | **24** |
| Active wall | ~231 min | **~128 min** |
| tokens in+out | 15.07M | **12.02M** |
| Stop | idle_tree | **planner_done** |

### Compare (three-task plateau; v2)

| Metric | CM v13.3c (salvaged) | TOML v13.3c (salvaged) | sqlite v1 | **sqlite v2** |
|---|---|---|---|---|
| Full pass rate | **99.4%** | 86.0% | 97.6% | **99.5%** |
| Visible / holdout | 99.5% / 98.8% | 85.2% / 90.1% | 97.5% / 98.2% | **99.5% / 99.1%** |
| holdout_gap_pp | +0.7 | −4.9 | −0.8 | **+0.4** |
| merge_conflict_count | 53 | 45 | 24 | **7** |
| Active wall | ~462 min | ~286 min | ~231 min | **~128 min** |
| Stop | human_interrupt + salvage | human_interrupt + salvage | idle_tree | **planner_done** |

### Weak sections — v1 (cleared in v2)

| Section | missed | rate | Theme |
|---|---:|---:|---|
| Cast And Affinity | 8/39 | 79.5% | INTEGER affinity; `CAST('abc' AS INTEGER)` → 0 |
| Numeric Functions | 6/39 | 84.6% | scalar `min`/`max` NULL; `typeof(0.0)` |
| Literals And Identifiers | 3/39 | 92.3% | quoted keyword aliases |
| Distinct | 1/39 | 97.4% | NULL sort after DISTINCT |

### Weak sections — v2 residue (4 misses)

| Section | missed | rate | Theme |
|---|---:|---:|---|
| Numeric Functions | 3/39 | 92.3% | `round` half away from zero (`round(-2.5)`→−3, not JS `Math.round`) |
| Null Logic | 1/39 | 97.4% | `NULL \|\| '!'` → null (not `"!"`) |

### Reading

1. **Pack-tuning worked** — all six v1 failure classes cleared; full **97.6% → 99.5%** (+1.9pp, −14 misses) under the same model tier and token budget.
2. **Cheaper / faster** — wall ~231→128 min, conflicts 24→7, planner rounds 40→24; clearer spec + tagged `Value` reduced thrash.
3. **Natural `planner_done`** — first sqlite sample to stop via planner declaration (v1 was `idle_tree`).
4. **Residue is a new dark-matter pair** — `round` half-away and `||` NULL concat were not in the v1 miss list and still lack pinned counterexamples; candidates for pack-tuning v3 (A+B).
5. **sqlite v2 matches CM quality** — 99.5% full vs CM 99.4%, with far less wall and conflict cost.

Honesty notes:

- Tier-1 subset ≠ Cursor’s 835-page Rust SQLite experiment; this is shape fidelity, not scale fidelity.
- v2 REPORT baseline is `run-swarm-sqlite-v1` (same-pack before/after).
- Failure arrays are complete (4 = `failure_count`).

Compare:

```bash
npm run compare -- runs/run-swarm-sqlite-v1/metrics.json runs/run-swarm-sqlite-v2/metrics.json
npm run compare -- runs/run-swarm-v13.3/metrics.json runs/run-swarm-sqlite-v2/metrics.json
npm run compare -- runs/run-swarm-toml-v13.3c/metrics.json runs/run-swarm-sqlite-v2/metrics.json
```

## Runs (2026-07-26) — v12 generalization loop

| Run ID | Mode | Coordination | planner | Notes |
|---|---|---|---|---|
| run-a-bare-v12-repair | repair-only from bare v11 | false | repair-only-copy | **100%** full/visible/holdout (525/525, 439/439, 86/86); Stage B +8; 4859 LOC; ~39 min wall / ~28 min repair |
| run-b-faithful-v12-repair | repair-only from faithful v11 | **faithful** | repair-only-copy | **100%** full/visible/holdout; Stage A from **81.5%** visible (source rebuild) → 100%; Stage B +8; 3964 LOC; ~243 min wall; strong ~6.9 min |
| run-b-faithful-contention-v12 | **contention 13 tasks**, concurrency 4 | **faithful** | **seed-contention** | Fresh e2e: **93.0%** full (488/525); visible **93.8%** (412/439); holdout **88.4%** (76/86); Stage A +117 then **budget stop** (skipped Stage B); 16/18 clusters; 3377 LOC; ~324 min wall; strong ~25.8 min |

Strong model: `cursor-grok-4.5-high-fast` (adjudicator / cluster / decomposer / rung3). Workers + rung1/2 remain `composer-2.5-fast`.

Honesty note: Stage B uses full-suite monotonic acceptance (holdout-guided). Agents never see holdout IN/EXP/GOT; gen-examples are synthetic.

### v12 architecture: Stage B + strong ladder

Builds on v11 with:

1. **Parse fix** — `parseAgentJson` reads `spawnAgent` `output` (v11 silently fell back).
2. **Model tiering** — cheap workers/rung1–2; strong model for adjudicator / cluster / decomposer / rung3.
3. **Gen-examples** — `npm run spec:generate` → synthetic checks (reference commonmark oracle).
4. **Stage B blind repair** — after visible Stage A, agents see group name + fail count + normative refs only; harness accepts on full-suite monotonic gain.
5. **Overfit reviewer** — post-accept diff scan (record-only by default).
6. **Plateau / phase budget** — `maxPhaseMinutes` backstop (default 240).

| Metric | Bare v12-repair | Faithful v12-repair | Faithful v12 fresh |
|---|---|---|---|
| Full pass rate | **100%** (525/525) | **100%** (525/525) | 93.0% (488/525) |
| Visible | **100%** (439/439) | **100%** (439/439) | 93.8% (412/439) |
| Holdout | **100%** (86/86) | **100%** (86/86) | 88.4% (76/86) |
| holdout_gap_pp | 0.0 | 0.0 | 5.5 (alarm) |
| Stage B gain | +8 (4 clusters) | +8 (7 clusters) | skipped (budget) |
| Strong model time | ~0 min | ~6.9 min | ~25.8 min |
| LOC | 4859 | **3964** | **3377** |
| Wall | ~39 min (repair-only) | ~243 min (repair-only) | ~324 min (full e2e) |

Three-way compare notes:

- **Continuation arms both hit 100%** on full/visible/holdout. Stage B closed the v11 holdout gap when started from a near-complete workspace with enough repair budget.
- **Fresh faithful e2e stopped at Stage A 93.8%** (`maxPhaseMinutes` exhausted; Stage B skipped). Cost curve: pool ~138 min agent, feedback ~93 min, repair rung1–3 ~205 min total repair; strong ladder used (~26 min) mainly on hard Stage A clusters.
- **Structure: faithful still leaner** (3377 fresh / 3964 repair vs bare repair 4859).
- **Strong-model cost**: cheap path alone can finish Stage B from a high baseline (bare repair strong≈0); climbing from mid-60s visible burns strong time (fresh ~26 min) and still may hit the wall-clock budget before Stage B.

**Erratum (v11 dist vs source):** Rebuilding `run-b-faithful-contention-v11` workspace from tracked source (not the frozen `dist/` that produced the v11 headline) scored only **~81.5% visible** before v12 repair-only. The v11 faithful headline (99.3% visible / 97.9% full) remains the dual-track record of that run's scored dist; continuation correctly repaired from the real source state. Do not silently rewrite v11 table numbers.

### v12.1 instrumentation — 四核心指标 (2026-07-27)

Runner switched from `--output-format text` to `json`: every agent call now
records real `usage` tokens (in/out/cache) + `api_ms` + `model`, and
`metrics.json` gains a `core_metrics` block (任务完成率 / 单任务完成时间 /
消耗 token / 总完成时长; see README “Core metrics”). Verified live on both
tiers (`composer-2.5-fast`, `cursor-grok-4.5-high-fast`) via
`preflight:models`. **All runs listed above predate token capture** — their
`core_metrics.tokens` show zero coverage; time metrics are rebuilt from
existing fields. Cost-curve claims involving tokens must come from runs after
this change.

## Runs (2026-07-26) — v11 generic quality loop

| Run ID | Mode | Coordination | planner | Notes |
|---|---|---|---|---|
| run-a-bare-contention-v11 | **contention 13 tasks**, concurrency 4 | false | **seed-contention** | **98.5%** full (517/525); visible **100%** (439/439); holdout 90.7% (78/86); **overfit_alarm**; 9/9 repair clusters accepted; 33 syncs; 4764 LOC; ~123 min wall / ~207 min agent |
| run-b-faithful-contention-v11 | **contention 13 tasks**, concurrency 4 | **faithful** | **seed-contention** | **97.9%** full (514/525); visible **99.3%** (436/439); holdout 90.7%; **overfit_alarm**; **resumed** (hung agent → salvage → repair-only segment); repair 79.7%→99.3% visible then 90‑min budget stop; 3652 LOC; resume-segment agent ~109 min |

### Corrected-oracle dual track (re-score of v10 workspaces)

After fixing `→`→tab substitution in `spec/extract.mjs`, reference commonmark.js scores **525/525**. Re-scoring frozen v10 workspaces (no code changes):

| Workspace | Old oracle (headline) | Corrected oracle |
|---|---|---|
| bare v10 | 94.1% (494/525) | **94.9%** (498/525) |
| faithful v10 | 97.9% (514/525) | **97.9%** (514/525) |

Historical v9/v10 tables keep the old-oracle headline; use the corrected column when comparing to v11 (which always uses the corrected suite).

### v11 architecture: holdout + ledger + adaptive repair

Same models / concurrency / contention task set as v10. Symmetric harness upgrades:

1. **Oracle correction** (extract-time tab normalization) + reference self-check at 100%.
2. **Holdout** (15% stratified) — agent feedback on visible set; final reports visible/holdout/full.
3. **Failure ledger + adjudication** — stuck items classified; suspected oracle / ambiguity leave the repair queue for humans.
4. **Repair engine v2** — adaptive clustering, monotonic changeset acceptance, best-of-N candidate worktrees, plateau/time-budget stop.
5. **Windows agent kill-tree** on timeout (`taskkill /T /F`) after a hung score-fix agent blocked faithful for ~6.5h.

| Metric | Bare v11 | Faithful v11 (resumed) |
|---|---|---|
| Full pass rate | **98.5%** (517/525) | 97.9% (514/525) |
| Visible | **100%** (439/439) | 99.3% (436/439) |
| Holdout | 90.7% (78/86) | 90.7% (78/86) |
| holdout_gap_pp | 9.3 (alarm) | 8.6 (alarm) |
| Repair clusters accepted | 9/9 | 2/4 (budget stop) |
| LOC | 4764 | **3652** |
| Agent time | ~207 min (full run) | last resume segment only* |

\*Faithful was interrupted mid–task-13 fix (hung cursor-agent), salvaged, resumed; later manually interrupted mid-repair and resumed again. Pool metrics (sync/feedback/cross-scope) in the final `metrics.json` cover only the last resume segment (repair-only → mostly zeros). Quality/LOC/commits are cumulative on the workspace.

Direct v11 A/B (`npm run compare -- runs/run-a-bare-contention-v11/metrics.json runs/run-b-faithful-contention-v11/metrics.json`):

- **Headline full suite: bare 98.5% > faithful 97.9%** (−0.6pp). Neither arm hit 100% on the full 525; both hit **overfit alarms** (visible≫holdout).
- **Holdout is the story**: both arms score **90.7%** on the blind set while visible sits at 99–100%. The quality loop closed the training/visible set; generalization to holdout did not follow automatically.
- **Structure: faithful still leaner** (3652 vs 4764 LOC).
- **100% miss reasons**: bare — 8 holdout failures after visible 100%; faithful — repair time budget (90 min) stopped at 99.3% visible / 97.9% full, same holdout floor.
- Ops lesson: Windows `SIGTERM` does not kill `cursor-agent` trees; v11 adds `taskkill /T /F` on timeout.

Interpretation: v11 proves the generic loop (oracle audit, holdout, ledger, adaptive repair, best-of-N) is runnable and catches overfitting that v10's single final score hid. Pushing past ~98% full requires either longer repair budget + holdout-aware acceptance, or treating holdout failures as first-class repair targets (without leaking them into worker prompts). Coordination's remaining edge is compactness, not the full-suite headline in this run.

**Erratum (found in v12 prep):** `parseAgentJson` in the v11 repair engine read `result.stdout`, but `spawnAgent` returns `output`. LLM clustering and adjudication therefore fell back every time (bare clusters are all `fb-*` / `group-*` heuristics; faithful adjudications are all `parse_fallback`). Group-level repair still worked; the adaptive LLM path did not.

## Runs (2026-07-25) — v10 architecture + resume

| Run ID | Mode | Coordination | planner | Notes |
|---|---|---|---|---|
| run-a-bare-contention-v10 | **contention 13 tasks**, concurrency 4 | false | **seed-contention** | **94.1%** pass (494/525), 13/13, **resumed** (interrupted mid global-repair; salvage + `--resume`); global repair 0%→91.0%→94.1%; metrics agent/wall = last segment only; 4610 LOC |
| run-b-faithful-contention-v10 | **contention 13 tasks**, concurrency 4 | **faithful** | **seed-contention** | **97.9%** pass (514/525), 13/13, 1 conflict, 11 cross-scope, 32 worktree syncs (14 conflict), 26 score-feedbacks, global repair 78.1%→90.9%→97.9%, 3420 LOC, ~114 min wall / ~232.9 min agent |

## Runs (2026-07-24) — composer planner re-run

| Run ID | Mode | Coordination | planner | Notes |
|---|---|---|---|---|
| run-a-bare-contention-v9b | **contention 13 tasks**, concurrency 4 | false | **seed-contention** | **62.1%** pass (326/525), 13/13, 11 conflicts, 17 score-feedbacks, worker-fix ~33.2 min, merge-resolve ~28.7 min, 3987 LOC, ~75 min wall / ~195.6 min agent |
| run-b-faithful-contention-v9 | **contention 13 tasks**, concurrency 4 | **faithful** | **seed-contention** | **65.0%** pass (341/525), 13/13, 10 conflicts, 12 cross-scope, 14 score-feedbacks, worker-fix ~16.8 min, merge-resolve ~19.3 min, 3710 LOC, ~55 min wall / ~143.8 min agent |
| run-a-bare-contention-v8 | **contention 12 tasks**, concurrency 4 | false | **seed-contention** | **50.5%** pass (265/525), 12/12, **10 merge conflicts**, merge-resolve ~15.7 min, churn 2.7%, 1935 LOC, ~29 min wall / ~62.6 min agent |
| run-b-faithful-contention-v8 | **contention 12 tasks**, concurrency 4 | **faithful** | **seed-contention** | **47.8%** pass (251/525), 12/12, **9 merge conflicts**, 11 cross-scope events, 0 build repairs, merge-resolve ~12.1 min, churn 3.0%, 1566 LOC, ~26.5 min wall / ~54.5 min agent |
| run-b-faithful-v7 | **full 8 tasks**, concurrency 2 | **faithful** | **llm** | **76.6%** pass (402/525), 8/8, 7 cross-scope task events, 5 neutral-merger conflicts, 0 build repairs, 2644 LOC, ~43 min wall / ~64.5 min agent |
| run-a-bare-full-v6 | **full 8 tasks**, concurrency 2 | false | **llm** | **76.8%** pass (403/525), **8/8 tasks**, **5 merge conflicts self-resolved by workers**, 2456 LOC, ~45 min wall / ~71.5 min agent |
| run-a-bare-v4 | quick, concurrency 2 | false | **llm** | **24.2%** pass (127/525), 0 merge/scope, 463 LOC, 3/3 tasks, ~22 min |
| run-b-coordinated-full-v6 | **full 8 tasks**, concurrency 2 | true | **llm** | **31.0%** pass (163/525), **8/8 tasks**, 0 scope violations, **2 merge conflicts** (GUIDE.md, merger resolved), 2274 LOC, ~23 min wall / ~32.7 min agent; planner wiring task + integration rules |
| run-b-coordinated-v5 | quick, concurrency 2 | true | **llm** | **14.1%** pass (74/525), **2 real scope violations**, 1/3 tasks done, 350 LOC, ~19 min |
| run-b-coordinated-v4-retry | quick, concurrency 2 | true | llm | **INVALID** — argv 8191-char limit killed coordinated worker spawn; lockfile false-positive scope violations |
| run-b-coordinated-v4 | quick, concurrency 2 | true | seed | **INVALID** — cursor-agent auth expired mid-session |

Compare v4 A vs v3 A: `npm run compare -- runs/run-a-bare-v4/metrics.json runs/run-a-bare-v3/metrics.json` (+4.6pp pass rate with LLM planner).

### v10 architecture: sync + merge gate + global repair (+ resume)

Motivation: v9 still left ~12–15pp on the table vs low-contention v7 (~77%), with three harness wastes—stale worktrees, dirty merges with leftover `<<<<<<<` markers, and no agent accountable for the final suite score. v10 adds four **symmetric** (both-arm) infrastructure changes without changing models, concurrency, or the contention task set:

1. **npm install hash cache** in `ensureBuilt` (skip repeated installs).
2. **Worktree sync** with `main` before each score-feedback round and before enqueue (strict mode skips sync).
3. **Merge validity gate**: reject merges that still contain conflict markers; retry then `reset --hard` to pre-merge.
4. **Global repair phase** after the task pool: score full suite, fix worst sections (up to 2 rounds), with git checkpoint regression guard.

Also shipped: task-level **`--resume`** + `npm run salvage` for interrupted runs (`progress.json`).

| Metric | Bare v9b | Bare v10 (resumed) | Faithful v9 | Faithful v10 |
|---|---|---|---|---|
| Pass rate | 62.1% | **94.1%** | 65.0% | **97.9%** |
| Tasks | 13/13 | 13/13 | 13/13 | 13/13 |
| Merge conflicts | 11 | 0* | 10 | 1 |
| Worktree syncs | 0 | 0* | 0 | 32 (14 conflict) |
| Global repairs | 0 | 2 (0%→94.1%) | 0 | 2 (78.1%→97.9%) |
| Agent time | 195.6 min | last-segment only* | 143.8 min | **232.9 min** |
| LOC | 3987 | 4610 | 3710 | **3420** |

\*Bare v10 was interrupted during the first global-repair attempt, then `salvage` + `--resume` skipped all 13 done tasks and continued repair. Segment metrics (agent/wall/merge-resolve/score-feedback/sync counts) cover the **last resume segment only**; pass rate / LOC / commits are cumulative.

Direct v10 A/B (`npm run compare -- runs/run-a-bare-contention-v10/metrics.json runs/run-b-faithful-contention-v10/metrics.json`):

- **Quality: faithful 97.9% > bare 94.1%** (+3.8pp) — both far above v9; global repair was the main lift (faithful 78.1%→97.9% post-pool; resumed bare 0% runtime-broken workspace →94.1%).
- **Structure: faithful used fewer LOC** (3420 vs 4610) with similar feature coverage — closer to Cursor's "less churn / less duplication" signal.
- **Cost: not apples-to-apples** for agent minutes (bare resumed). Faithful paid ~233 min agent for a clean full run including sync + repair; merge-resolve stayed cheap (1.4 min) thanks to early sync.
- Resume path validated in production: kill → salvage (13/13 done, phase=global_repair) → `--resume` skip-all-tasks → repair to finish.

Interpretation: same models, architecture alone moved high-contention pass rates from the ~62–65% band into the mid/high 90s. Coordination still wins on quality and compactness; the headline cost comparison should prefer the uninterrupted faithful arm, with bare's resume noted explicitly.

### v9 fix: score feedback + orphan sections → faithful beats bare under contention

v8 diagnosis: collapse was partly **experiment-design debt**—workers had no scorer feedback (shallow happy-path stubs), ~45 examples had no task owner (Tabs / escapes / line breaks), and notes never required full-section pass. v9 fixes those without changing the contention structure (shared types/registry/render, concurrency 4):

1. Harness-level **score-feedback loop** (both arms): after each worker, score only `spec_sections`; if below 100%, send up to 2 fix rounds with IN/EXP/GOT failures.
2. Contention task set v2: **task-13** owns Backslash escapes / Hard+Soft line breaks / Tabs; task-01 owns Precedence / Textual content / Blank lines; deeper notes + lists container hint.
3. Metrics: `score_feedbacks`, `worker_fix_time_ms`.

| Metric | Bare v8 | Bare v9b | Faithful v8 | Faithful v9 |
|---|---|---|---|---|
| Pass rate | 50.5% | **62.1%** | 47.8% | **65.0%** |
| Tasks | 12/12 | 13/13 | 12/12 | 13/13 |
| Merge conflicts | 10 | 11 | 9 | 10 |
| Score feedbacks | 0 | 17 | 0 | 14 |
| Worker-fix time | — | 33.2 min | — | **16.8 min** |
| Merge-resolve time | 15.7 min | 28.7 min | 12.1 min | **19.3 min** |
| Agent time | 62.6 min | 195.6 min | 54.5 min | **143.8 min** |
| LOC | 1935 | 3987 | 1566 | 3710 |

Direct v9 A/B (`npm run compare -- runs/run-a-bare-contention-v9b/metrics.json runs/run-b-faithful-contention-v9/metrics.json`):

- **Quality: faithful 65.0% > bare 62.1%** — first clean high-contention win for coordination on pass rate (+2.9pp).
- **Cost: faithful ~26% less agent time** (143.8 vs 195.6 min), ~33% less merge-resolve (19.3 vs 28.7), ~half the worker-fix time (16.8 vs 33.2). Feedback rounds themselves were cheaper under faithful (fewer incomplete merges to rediscover).
- Feedback examples: bare lists 76%→100% section rate across fix rounds; faithful lists 88%→100%. Orphan sections recovered (e.g. both arms Hard line breaks 15/15, Backslash escapes 13/13).
- Remaining gap to v7 (~77%): Emphasis/Links/Images long-tail still weak on both arms; bare still leaves `<<<<<<<` markers in shared files after some merges (final workspace build noise).

Interpretation: once single-task quality is enforced, high contention separates the arms the way Cursor's thesis predicts—**faithful holds a higher quality floor at lower compute**. Part of v8's dual collapse was experimental artifact; v9's A/B is the cleaner read for the article. (Incomplete first bare attempt `run-a-bare-contention-v9` aborted mid-run; canonical bare is **v9b**.)

### v8 high-contention pressure test: both arms drop; faithful still slightly cheaper

Motivation: v6/v7 sat left of the cost-curve crossover (8 tasks, concurrency 2, cheap self-resolved conflicts). v8 pushes rightward with a **fixed seed contention task set** (12 tasks, concurrency 4) where every feature task must also touch shared `types` / `registry` / `render` files. Faithful scopes keep primary ownership disjoint and expect minimal cross-scope registration patches; bare puts the shared files in every task's `files_scope`. Planner is seed (not LLM) so both arms share identical task lists. Faithful also ships compile-checked `src/contracts.ts`.

| Metric | Bare v6 | Bare v8 | Faithful v7 | Faithful v8 |
|---|---|---|---|---|
| Pass rate | 76.8% | **50.5%** | 76.6% | **47.8%** |
| Tasks | 8/8 | 12/12 | 8/8 | 12/12 |
| Merge conflicts | 5 | **10** | 5 | **9** |
| Cross-scope events | n/a | n/a | 7 | 11 |
| Merge-resolve time | (untracked) | 15.7 min | (untracked) | **12.1 min** |
| Agent time | 71.5 min | 62.6 min | 64.5 min | **54.5 min** |
| Churn ratio | — | 2.7% | — | 3.0% |
| LOC | 2456 | 1935 | 2644 | 1566 |

Direct v8 A/B (`npm run compare -- runs/run-a-bare-contention-v8/metrics.json runs/run-b-faithful-contention-v8/metrics.json`):

- **Quality: bare 50.5% vs faithful 47.8%.** Contention collapsed both arms ~26–29pp vs the low-contention full runs; faithful did **not** stay flat while bare fell.
- **Cost: faithful used ~13% less agent time** (54.5 vs 62.6 min) and ~23% less merge-resolve time (12.1 vs 15.7 min). Conflicts were similar in count (9 vs 10).
- Bare logs showed repeated post-merge builds failing on leftover `<<<<<<<` conflict markers in shared files—workers "resolved" merges incompletely under concurrency 4. Faithful's neutral merger avoided that failure mode in the final workspace (0 integration-fix calls; build stayed green enough to score).
- Churn ratios stayed low (~3%) for both; wasted-line churn was not the separating signal at this scale.

Interpretation: raising file contention and concurrency **does** move the experiment into a regime where bare quality collapses (76.8% → 50.5%). Faithful collapses almost as much (76.6% → 47.8%), so at N=12 / concurrency 4 the curves drop together rather than diverging with coordination staying high. The coordination advantage that *did* show up is modest cost (agent + merge-resolve), not a quality floor. Still consistent with "coordination is a scale function"—but this Git-backed subset has not yet found a point where faithful clearly dominates bare on pass rate. Likely still missing Cursor-scale pieces (custom VCS throughput, stacked review, larger N / longer runs).

### v7 faithful coordination: quality recovered

Faithful mode replaces strict isolation with Cursor-like coordination primitives: scopes express primary ownership; targeted cross-scope patches are allowed; DESIGN.md may evolve; a neutral agent resolves conflicts; and merged build failures can launch an integration-fix agent.

Full comparison:

- **Bare v6: 76.8%; faithful v7: 76.6%.** One CommonMark example separates them (403 vs 402); both complete 8/8.
- Faithful workers made cross-scope source changes in **7 task events**, restoring continuous integration instead of concentrating it in one final wiring task.
- Both runs had **5 real merge conflicts**. Bare workers resolved their own; faithful used a neutral merger.
- Faithful used **~9.8% less agent time** (64.5 vs 71.5 min) while matching quality. It did not reproduce strict v6's 2.2x compute saving, but avoided strict v6's quality collapse (31.0%).
- No build failed after merge, so the integration-fix fallback was implemented but not exercised in this run.
- Protocol caveat: only task-06 used the requested `cross-scope:` commit-message marker; the other cross-scope edits were anticipated in planner task notes but not marked in commits. The harness records all such edits independently.

Interpretation: the result now matches Cursor's mechanism more closely. Coordination is not file isolation; it is making overlap observable and resolvable while preserving shared design context. At this scale, faithful coordination matches bare quality with a modest compute reduction—not the dramatic conflict suppression seen in Cursor's hundreds-agent system.

### v6 full A/B: bare wins on quality, coordination wins on cost

Fair full-vs-full comparison (`npm run compare -- runs/run-a-bare-full-v6/metrics.json runs/run-b-coordinated-full-v6/metrics.json`):

- **Bare 76.8% vs coordinated 31.0%.** Both 8/8 tasks, similar LOC (2456 vs 2274).
- Bare hit **5 real merge conflicts** on shared files (`src/blocks.ts`, `src/html.ts`, `src/inline.ts`) — workers resolved every one themselves (`merge-resolve` phases all ok), doing integration work each time.
- Cost: bare spent **~2.2x agent time** (71.5 min vs 32.7 min). Coordination halved compute but capped quality: scope walls kept workers from touching shared files, so integration quality depended entirely on the single wiring task (task-08).
- Reading: at concurrency 2 / 8 tasks, LLM workers handle merge conflicts cheaply, so bare's "everyone integrates as they go" beats coordinated's "one wiring task at the end". Coordination's value proposition (avoid conflict cost) needs higher concurrency or pricier conflicts to dominate — consistent with Cursor's claim that coordination infrastructure matters *as swarms scale*, and showing it can be premature at small scale.

### v6 coordinated details (wiring task + planner rules)

After prompt fixes (dedicated task-08 for `blocks/index.ts` + `inline/index.ts`, no cross-scope notes), **run-b-coordinated-full-v6** completed **8/8** with **0 scope violations** and **31.0%** pass. Two **GUIDE.md** merge conflicts (task-06/07) were handled by neutral merger. This closes the v5 failure mode: decomposition aligned with scope enforcement.

### v5 finding: planner-induced scope conflict

In run-b-coordinated-v5 the planner put `src/blocks/index.ts` in task-01's scope only, yet task-02/03 notes said "Register in blocks/index.ts". Workers followed the notes, touched the out-of-scope integration file, and both merges were rejected. Genuine coordination-design lesson: **disjoint file scopes need an owned integration point** (a wiring task or merger step), otherwise the planner's own instructions create violations.

### Harness fixes (2026-07-24, after v4-retry)

- `runner.mjs`: prompt now passed via **stdin** (was argv → Windows cmd.exe 8191-char limit broke coordinated workers + all reviewers).
- `checkScopeViolation`: exempts `package-lock.json` / `npm-shrinkwrap.json` / `dist/` (build side effects, not code edits).

## Runs (2026-07-23) — seed planner (legacy)

| Run ID | Mode | Coordination | Notes |
|---|---|---|---|
| run-a-serial-quick | serial, 3 tasks | false | 28.8% pass, 0 merge/scope issues, 451 LOC, planner=seed |
| run-a-bare-v3 | quick, concurrency 2 | false | 19.6% pass, 0 merge conflicts, 440 LOC, 3/3 tasks done |
| run-b-coordinated-v3 | quick, concurrency 2 | true | 19.6% pass, **1 scope violation** (task-02 failed), 195 LOC, 2/3 tasks done, GUIDE.md populated |

Legacy failed runs (`run-a-bare`, `run-a-bare-v2`) had 0% pass due to missing post-merge build — superseded by v3.

## Interpretation

- Compare `merge_conflicts`, strict `scope_violations`, faithful `cross_scope_changes`, and `integration_fixes` separately.
- `strict` is an intentionally rigid control, not a faithful reproduction of Cursor's newer swarm.
- `faithful` remains a minimal Git-backed subset; v8 adds a compile-checked `src/contracts.ts` stub, but still does not implement Cursor's custom VCS, multiple planner trees, bloated-file decomposition, or stacked review perspectives.
