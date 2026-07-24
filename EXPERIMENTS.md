# Experiments log

## Protocol

- **Run A (bare)**: `npm run run:quick -- --run-id=run-a-bare-v4`
- **Run B (coordinated)**: `npm run run:quick:coordinated -- --run-id=run-b-coordinated-v4`
- **Run B faithful**: `npm run run:faithful -- --run-id=run-b-faithful-v7`
- **v8 high-contention A/B**: `npm run run:v8:bare` / `npm run run:v8:faithful` (`--task-set=contention`, concurrency 4, seed planner)
- **Serial minimal loop**: `npm run run:serial -- --quick --run-id=run-a-serial-quick`
- **Compare**: `npm run compare -- runs/run-a-bare-contention-v8/metrics.json runs/run-b-faithful-contention-v8/metrics.json`

## Runs (2026-07-24) — composer planner re-run

| Run ID | Mode | Coordination | planner | Notes |
|---|---|---|---|---|
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
