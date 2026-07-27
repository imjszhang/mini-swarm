# Experiments log

## Protocol

- **Run A (bare)**: `npm run run:quick -- --run-id=run-a-bare-v4`
- **Run B (coordinated)**: `npm run run:quick:coordinated -- --run-id=run-b-coordinated-v4`
- **Run B faithful**: `npm run run:faithful -- --run-id=run-b-faithful-v7`
- **v13 Cursor-faithful swarm**: `npm run swarm` / `npm run swarm:mock` / `npm run swarm:smoke` (planner tree + zero test signal + review stack; wall-clock budget)
- **v8/v9/v10/v11/v12 high-contention A/B**: `npm run run:contention:bare` / `npm run run:contention:faithful` (`--task-set=contention`, concurrency 4, seed planner; v9 score-feedback; v10 sync+gate+global repair; v11 holdout+ledger+adaptive repair; v12 Stage B + strong ladder)
- **Resume interrupted run**: `npm run salvage -- --run-id=RUN_ID --task-set=contention` then original command + `--resume` (task-level; agent/wall times in metrics cover last segment only — see README)
- **Repair-only continuation**: `npm run run -- --repair-only --from-run=PRIOR --run-id=NEW --task-set=contention [--coord-mode=faithful]`
- **Serial minimal loop**: `npm run run:serial -- --quick --run-id=run-a-serial-quick`
- **Compare (v12 repair arms)**: `npm run compare -- runs/run-a-bare-v12-repair/metrics.json runs/run-b-faithful-v12-repair/metrics.json`
- **Compare (v12 fresh faithful vs bare repair)**: `npm run compare -- runs/run-a-bare-v12-repair/metrics.json runs/run-b-faithful-contention-v12/metrics.json`
- **Compare (v11)**: `npm run compare -- runs/run-a-bare-contention-v11/metrics.json runs/run-b-faithful-contention-v11/metrics.json`
- **Compare (v10)**: `npm run compare -- runs/run-a-bare-contention-v10/metrics.json runs/run-b-faithful-contention-v10/metrics.json`
- **Compare (v9)**: `npm run compare -- runs/run-a-bare-contention-v9b/metrics.json runs/run-b-faithful-contention-v9/metrics.json`

## Runs (2026-07-27) — v13 Cursor-faithful swarm (S-A-008)

| Run ID | Mode | Notes |
|---|---|---|
| mock-v13-swarm2 | `--mock` | Tree + merge + observe score loop OK; 2 leaves done; planner_rounds=2 |
| smoke-v13-swarm | live, 15 min, conc=2 | Protocol OK: planner JSON → 22 leaves; 8 done; splitter×1; **18.3%** full; tokens captured (worker ~82% of non-cache total in short run) |
| **run-swarm-v13** | live, **240 min**, conc=4 | **69.1%** full (363/525); visible **68.8%** (302/439); holdout **70.9%** (61/86); gap **-2.1** (no overfit alarm); 22 planner rounds; 10 review stacks; 3 splits / 2 oversized blocks; 38/45 task completions recorded; 100 commits; 37 conflicts; 7739 LOC; wall ~244.5 min; agent ~316 min |

Models: planner/splitter/`review-spec` = `cursor-grok-4.5-high-fast`; workers/merger/`review-diff`/`review-codebase` = `composer-2.5-fast`.

### v13 architecture (zero test signal)

New entry `npm run swarm` (legacy `run.mjs` / repair-engine retained as control):

1. **Strong planner tree** — `swarm-planner` writes `DESIGN.md` + `tree.json` actions (`add_task` / `split_task` / …); never implements.
2. **Zero test signal** — agents never see examples, VERIFY_CMD, or pass/fail; scorer is harness-only observation (`score_curve` + final triple).
3. **Field Guide folder** — `guide/index.md` with line budget.
4. **Oversized VCS gate** — merge-queue blocks commits when `src/**` exceeds line budget → `splitter`.
5. **Review stack** — diff / codebase / spec perspectives every N merges; findings return to planner.
6. **Wall-clock budget** — default 240 minutes (Cursor 4h frame).

| Metric | run-swarm-v13 | v12 fresh faithful (control) |
|---|---|---|
| Full pass rate | **69.1%** (363/525) | 93.0% (488/525) |
| Visible / holdout | 68.8% / **70.9%** | 93.8% / 88.4% |
| holdout_gap_pp | **-2.1** | +5.5 (alarm) |
| Architecture | zero-signal swarm | test-driven pool+repair |
| Planner rounds | 22 | seed-contention (fixed) |
| Reviews / splits | 10 / 3 | n/a / n/a |
| Tokens (in+out) | **9.59M** (usage 134/137) | n/a (pre-v12.1) |
| Worker token share | 47.1% (role); cheap model 80.5% | n/a |
| Strong model token share | 19.5% | n/a |
| LOC | 7739 | 3377 |
| Wall | ~244.5 min | ~324 min |

Honesty notes:

- Quality is **lower** than the test-driven v12 pipeline by design (Cursor's own 4h runs were often 73–85% on a different task). Zero-signal forbids score feedback and Stage A/B repair.
- Holdout **above** visible (gap −2.1) is the reverse of v11/v12 overfit alarms — evidence that agents were not fitting the official example set.
- Worker role is only ~47% of tokens because merger + review stack + planner also burn tokens; **cheap-model** share remains ~80%. Cursor's “workers ≥69–90%” refers to role mix on their stack, not identical accounting.
- Declared boundary: git worktrees, not custom VCS; concurrency 4, not hundreds of agents.

Compare (observational): `npm run compare -- runs/run-b-faithful-contention-v12/metrics.json runs/run-swarm-v13/metrics.json`

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
