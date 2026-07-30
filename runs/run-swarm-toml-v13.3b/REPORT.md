# Report: run-swarm-toml-v13.3b

Generated: 2026-07-30T03:19:48.699Z

## 1. Experiment metadata

| Field | Value |
|---|---|
| task_pack | toml-json |
| run_id | run-swarm-toml-v13.3b |
| protocol | zero-signal swarm v13.3; run_to_done=true |
| concurrency | 8 |
| models | planner/splitter/`review-spec` = `cursor-grok-4.5-high-fast`; workers/merger/`review-diff`/`review-codebase` = `composer-2.5-fast` |
| started / finished | 2026-07-29T10:49:18.871Z / 2026-07-29T20:52:23.975Z |
| segments | 2 (human pause + `--resume`) |
| active wall (min) | 487.2 (~`maxWallMinutes=480` hard stop) |
| stop reason | wall_budget |
| finalized / salvaged | true / false |
| note | Post stop-policy fix rerun (`parseFailStreak` / `unproductiveStreak` split). Compare prior TOML `run-swarm-toml-v13.3` (76.4%, early idle). |

## 2. Core metrics

| Metric | Value |
|---|---|
| leaf done / total | 513 / 946 (54.2%) |
| task time mean / p50 / max (min) | 6.45 / 6.03 / 29.84 |
| tokens in+out (+cache_read) | 63.57M in+out (+~271M cache_read) across 1084 calls |
| wall (active min) | 487.2 |
| effective_parallelism | 9.66 |

## 3. Quality

| Score | Value |
|---|---|
| full | 85.1% (473/556) |
| visible | 84.1% (391/465) |
| holdout | 90.1% (82/91) |
| holdout_gap_pp | -6 |
| overfit_alarm | false |

### Weak sections (by misses)

| Section | missed | rate |
|---|---|---|
| Spec Examples | 18/56 | 67.9% |
| Keys | 12/60 | 80.0% |
| Strings | 12/71 | 83.1% |
| Encoding | 6/12 | 50.0% |
| Root | 5/9 | 44.4% |
| Offset Date-Time | 5/26 | 80.8% |
| Floats | 5/44 | 88.6% |
| Tables | 5/58 | 91.4% |

### Failure buckets (from scored failure sample)

| Bucket | Count |
|---|---|
| total failure_count | 83 |
| valid output mismatch (sample) | 11 |
| invalid accepted (sample) | 9 |
| other (sample) | 0 |

## 4. Process health

| Signal | Value |
|---|---|
| merge_conflict_count | 18 |
| zero-pass observe windows | 0 |
| planner_parse_failures | 6 |
| planner_rounds | 131 |
| self_check_total | 3821 |
| reviews | 92 |

### Conflict hotspots

| File | conflicts |
|---|---|
| src/parse.ts | 5 |
| src/error.ts | 3 |
| src/keys.ts | 2 |
| src/values/lit-body.ts | 2 |
| src/cursor.ts | 1 |
| src/skip.ts | 1 |
| src/values/timeseg.ts | 1 |
| src/values/calendar.ts | 1 |

## 5. Baseline compare

Baseline: `run-swarm-v13.3` (CommonMark v13.3 unless overridden).

| Metric | run-swarm-toml-v13.3b | run-swarm-v13.3 |
|---|---|---|
| task_pack | toml-json | commonmark |
| full | 85.1% | 98.1% |
| visible | 84.1% | 97.7% |
| holdout | 90.1% | 100.0% |
| conflicts | 18 | 39 |
| zero-pass observe | 0 | 0 |
| active wall min | 487.2 | 278.7 |
| self_check | 3821 | 2376 |

## 6. Analysis

### vs prior TOML acceptance (`run-swarm-toml-v13.3`)

| Metric | v13.3 (pre-fix) | v13.3b (this run) |
|---|---|---|
| full | 76.4% | **85.1%** (+8.7pp) |
| visible / holdout | 75.7% / 80.2% | **84.1% / 90.1%** |
| stop | idle_tree (parse×2 false idle) | **wall_budget** |
| planner_rounds | 9 | **131** |
| active wall | ~39 min | **~487 min** |
| tokens in+out | ~3.8M | **~63.6M** |
| conflicts | 11 | 18 |

Stop-policy fix did what it was for: the run was no longer killed by two planner JSON failures; it consumed the full `--run-to-done` hard wall (~480m) and kept climbing.

### Score trajectory (observe)

Rough path: ~62–68% early → ~73% near first pause → ~80% after resume → plateau **~83–84%** late; final full **85.1%**. Late merges still landed but gains slowed (~1pp per long stretch).

### Remaining gaps

Weakest miss counts: Spec Examples, Keys, Strings, Encoding, Root. Sampled failures mix **output mismatch** and **invalid accepted** — still a rejection/integration problem, not only “more wall time”.

Holdout **above** visible (gap −6pp): `overfit_alarm=false`. Formal \|gap\|&lt;5 bar fails only because holdout is *better*; not a classic overfit alarm.

### Migration reading

| Claim | Reading |
|---|---|
| Protocol + stop-policy health on second sample | **Supported** — wall stop, 0 zero-pass observe, conflicts low, 131 planner rounds |
| Absolute quality ≥90% on TOML | **Not yet** — 85.1% vs bar 90% / CM 98.1% |
| Longer wall alone closes the last ~5pp | **Unclear** — late plateau suggests need better invalid-reject / Spec Examples focus, not only more minutes |

## 7. Conclusion

- Success bar full≥90%: **FAIL** (85.1%)
- \|holdout gap\| &lt; 5pp: **FAIL** (−6; holdout higher than visible)
- zero-pass observe = 0: **PASS**
- Migration proposition after stop-policy fix: **STRONGER MIXED** — process migrates and quality rose +8.7pp vs early-idle TOML; absolute bar still open

Next levers: raise `maxWallMinutes` only if late slope returns; otherwise target Encoding/Control invalids + Spec Examples integration leaves. No auto model switch.

Compare command:

```bash
npm run compare -- runs/run-swarm-toml-v13.3/metrics.json runs/run-swarm-toml-v13.3b/metrics.json
npm run compare -- runs/run-swarm-v13.3/metrics.json runs/run-swarm-toml-v13.3b/metrics.json
```

