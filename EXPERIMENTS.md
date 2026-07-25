# Experiments log

## Protocol

- **Run A (bare)**: `npm run run:quick -- --run-id=run-a-bare-v4`
- **Run B (coordinated)**: `npm run run:quick:coordinated -- --run-id=run-b-coordinated-v4`
- **Run B faithful**: `npm run run:faithful -- --run-id=run-b-faithful-v7`
- **v8/v9/v10 high-contention A/B**: `npm run run:contention:bare` / `npm run run:contention:faithful` (`--task-set=contention`, concurrency 4, seed planner; v9 adds score-feedback; v10 adds worktree sync + merge gate + global repair)
- **Resume interrupted run**: `npm run salvage -- --run-id=RUN_ID --task-set=contention` then original command + `--resume` (task-level; agent/wall times in metrics cover last segment only — see README)
- **Serial minimal loop**: `npm run run:serial -- --quick --run-id=run-a-serial-quick`
- **Compare (v10)**: `npm run compare -- runs/run-a-bare-contention-v10/metrics.json runs/run-b-faithful-contention-v10/metrics.json`
- **Compare (v9)**: `npm run compare -- runs/run-a-bare-contention-v9b/metrics.json runs/run-b-faithful-contention-v9/metrics.json`

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
