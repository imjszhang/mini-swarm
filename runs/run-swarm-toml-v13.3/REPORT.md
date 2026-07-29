# Report: run-swarm-toml-v13.3

Generated: 2026-07-29T10:15:58.173Z

## 1. Experiment metadata

| Field | Value |
|---|---|
| task_pack | toml-json |
| run_id | run-swarm-toml-v13.3 |
| protocol | zero-signal swarm v13.3; run_to_done=true |
| concurrency | 8 |
| models | planner/splitter/`review-spec` = `cursor-grok-4.5-high-fast`; workers/merger/`review-diff`/`review-codebase` = `composer-2.5-fast` |
| started / finished | 2026-07-29T09:00:54.599Z / 2026-07-29T09:39:47.175Z |
| segments | 1 |
| active wall (min) | 38.9 |
| stop reason | idle_tree (`idle tree and no productive planner actions`) |
| finalized / salvaged | true / false |
| note | Fresh acceptance after aborting an earlier `auto`-model attempt (worktree residue). Same model tier as CommonMark `run-swarm-v13.3`. |

## 2. Core metrics

| Metric | Value |
|---|---|
| leaf done / total | 19 / 55 (34.5%) |
| task time mean / p50 / max (min) | 7.98 / 9.32 / 16.4 |
| tokens in+out (+cache) | 3,812,454 (+0) across 79 calls |
| wall (active min) | 38.9 |
| effective_parallelism | 5.29 |

## 3. Quality

| Score | Value |
|---|---|
| full | 76.4% (425/556) |
| visible | 75.7% (352/465) |
| holdout | 80.2% (73/91) |
| holdout_gap_pp | -4.5 |
| overfit_alarm | false |

### Weak sections (by misses)

| Section | missed | rate |
|---|---|---|
| Spec Examples | 22/56 | 60.7% |
| Control | 16/31 | 48.4% |
| Keys | 16/60 | 73.3% |
| Strings | 13/71 | 81.7% |
| Tables | 11/58 | 81.0% |
| Integers | 9/44 | 79.5% |
| Floats | 8/44 | 81.8% |
| Inline Tables | 8/44 | 81.8% |

### Failure buckets (from scored failure sample)

| Bucket | Count |
|---|---|
| total failure_count | 131 |
| valid output mismatch (sample) | 0 |
| invalid accepted (sample) | 20 |
| other (sample) | 0 |

## 4. Process health

| Signal | Value |
|---|---|
| merge_conflict_count | 11 |
| zero-pass observe windows | 0 |
| planner_parse_failures | 2 |
| planner_rounds | 9 |
| self_check_total | 142 |
| reviews | 3 |

### Conflict hotspots

| File | conflicts |
|---|---|
| src/values/temporal-calendar.ts | 3 |
| DESIGN.md | 2 |
| src/keys.ts | 2 |
| src/document.ts | 2 |
| src/comments.ts | 1 |
| src/contracts.ts | 1 |
| src/tables/standard.ts | 1 |
| src/scan.ts | 1 |

## 5. Baseline compare

Baseline: `run-swarm-v13.3` (CommonMark v13.3 unless overridden).

| Metric | run-swarm-toml-v13.3 | run-swarm-v13.3 |
|---|---|---|
| task_pack | toml-json | commonmark |
| full | 76.4% | 98.1% |
| visible | 75.7% | 97.7% |
| holdout | 80.2% | 100.0% |
| conflicts | 11 | 39 |
| zero-pass observe | 0 | 0 |
| active wall min | 38.9 | 278.7 |
| self_check | 142 | 2376 |

## 6. Analysis

### Score trajectory

Harness observe climbed roughly **68% → 73% → 75.5%** then plateaued; final full **76.4%**. Gains came early from skeleton (~67%) plus a few productive merges; late rounds added little.

### Why it stopped early

Stop was **idle_tree**, not wall budget. Tree leftovers: done **19/55**, pending **15**, running **8**, blocked **6**, retired **7**. End-of-run planner JSON parse failures (2, including failed json-repair) left the planner unable to issue productive actions while fine-grained helper leaves stayed stuck.

### Failure character

Weakest miss counts: Spec Examples, Control, Keys, Strings, Tables. Sampled failures are dominated by **invalid input accepted** (Control/Encoding especially) — parser too permissive on reject paths. Spec Examples misses point to integration gaps (AoT / tables / escapes), consistent with retired/blocked core leaves.

### Migration reading vs CommonMark v13.3

| Claim | Reading |
|---|---|
| Protocol migrates (task pack + zero-signal + finalize) | **Supported** — e2e finalized, no zero-pass observe, conflicts 11 (healthy) |
| Holdout / overfit discipline | **Supported** — gap −4.5pp, holdout above visible |
| Same swarm reaches CM-class absolute quality on TOML | **Not shown** — 76.4% vs CM 98.1%; only **9** planner rounds vs CM **65**; wall **39 min** vs **279 min** |

Same architecture/models prove **transfer of the harness**, not yet **transfer of the asymptotic score**. Comparable wall or planner-round budgets would be needed before claiming a fair quality race.

## 7. Conclusion

- Success bar full≥90%: **FAIL** (76.4%)
- holdout gap &lt; 5pp: **PASS** (−4.5)
- zero-pass observe = 0: **PASS**
- Migration proposition (high platform + healthy process on second sample): **MIXED / NOT YET**

Next levers (if continuing): resume / longer run with planner parse-fail resilience; dedicated invalid-reject work (Control/Encoding); fewer micro-helpers, more Spec Examples / AoT integration leaves.

Compare command:

```bash
npm run compare -- runs/run-swarm-v13.3/metrics.json runs/run-swarm-toml-v13.3/metrics.json
```

