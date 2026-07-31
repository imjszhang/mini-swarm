# Report: run-swarm-toml-v13.3c

Generated: 2026-07-31T03:37:49.635Z

## 1. Experiment metadata

| Field | Value |
|---|---|
| task_pack | toml-json |
| run_id | run-swarm-toml-v13.3c |
| protocol | hidden-grader swarm v13.3; run_to_done=true; engineering feedback gates on |
| concurrency | 8 |
| models | planner/splitter/`review-spec` = `cursor-grok-4.5-high-fast`; workers/merger/`review-diff`/`review-codebase` = `composer-2.5-fast` |
| started / finished | 2026-07-30T14:09:03.562Z / 2026-07-30T18:54:31.618Z |
| segments | 1 |
| active wall (min) | 285.5 (~279m live + finalize salvage) |
| stop reason | human_interrupt → salvage finalize (`stop_reason` unset / other) |
| finalized / salvaged | true / true |
| note | First long TOML arm after engineering-feedback + optional token-budget. Token cap left `null` (unlimited). Compare `run-swarm-toml-v13.3b` (85.1%, wall_budget ~487m). |

## 2. Core metrics

| Metric | Value |
|---|---|
| leaf done / total | 212 / 402 (52.7%) |
| retired leaves | 173 |
| task time mean / p50 / max (min) | 8.82 / 7.24 / 33.57 |
| tokens in+out (+cache_read) | 32.23M in+out (+~176M cache_read) across 505 calls |
| wall (active min) | 285.5 |
| effective_parallelism | 8.01 |
| harness_self_check_total | 1008 |
| integration-fix calls | 42 |

## 3. Quality

| Score | Value |
|---|---|
| full | 86.0% (478/556) |
| visible | 85.2% (396/465) |
| holdout | 90.1% (82/91) |
| holdout_gap_pp | -4.9 |
| overfit_alarm | false |

### Weak sections (by misses)

| Section | missed | rate |
|---|---|---|
| Spec Examples | 18/56 | 67.9% |
| Keys | 12/60 | 80.0% |
| Strings | 12/71 | 83.1% |
| Tables | 6/58 | 89.7% |
| Root | 5/9 | 44.4% |
| Offset Date-Time | 5/26 | 80.8% |
| Floats | 5/44 | 88.6% |
| Inline Tables | 4/44 | 90.9% |

Encoding: **12/12 (100%)** — was 6/12 (50%) on v13.3b.

### Failure buckets (from scored failure sample)

| Bucket | Count |
|---|---|
| total failure_count | 78 |
| valid output mismatch (sample) | 16 |
| invalid accepted (sample) | 4 |
| other (sample) | 0 |

## 4. Process health

| Signal | Value |
|---|---|
| merge_conflict_count | 45 |
| zero-pass observe windows | 0 |
| planner_parse_failures (metrics counter) | 0 |
| planner_rounds | 52 |
| self_check_total | 1652 |
| reviews | 40 |

Console also logged several planner JSON-repair / one compact-retry events; streaks stayed at 0 (no false idle stop).

### Conflict hotspots

| File | conflicts |
|---|---|
| src/parse.ts | 18 |
| DESIGN.md | 5 |
| src/values/local-datetime.ts | 4 |
| src/values/dispatch.ts | 3 |
| src/values/register.ts | 3 |
| src/errors.ts | 2 |
| src/scanner.ts | 2 |
| src/values/float.ts | 2 |

## 5. Baseline compare

Baseline: `run-swarm-toml-v13.3b`.

| Metric | run-swarm-toml-v13.3c | run-swarm-toml-v13.3b |
|---|---|---|
| task_pack | toml-json | toml-json |
| full | **86.0%** | 85.1% |
| visible / holdout | **85.2% / 90.1%** | 84.1% / 90.1% |
| Encoding section | **100%** | 50% |
| conflicts | 45 | 18 |
| zero-pass observe | 0 | 0 |
| active wall min | **285.5** (interrupted) | 487.2 (wall_budget) |
| planner_rounds | 52 | 131 |
| self_check | 1652 | 3821 |
| harness_self_check | **1008** | n/a |
| tokens in+out | ~32.2M | ~63.6M |

## 6. Analysis

### Score trajectory (observe, visible)

Rough path: ~65% early → ~79% by m31 → ~83% by m60 → plateau **~84–85%** from ~m120 onward (peak ~85.4% near m155, then oscillated ~84.3–84.7%). Human stop at ~279 active minutes; salvage full **86.0%**.

### vs v13.3b

- **+0.9pp full** with ~**42% less** active wall and ~**half** the tokens.
- Clearest structural win: **Encoding 50% → 100%** (+6 cases), consistent with pre-merge health / harness embedded self-check pushing rejection/UTF-8 wiring.
- Unmoved hard cluster: Spec Examples / Keys / Strings (same miss counts as v13.3b tops).
- Higher merge conflicts (45 vs 18), still no observe redline; process stayed productive (`unproductive_streak=0`).

### Migration / eng-feedback reading

| Claim | Reading |
|---|---|
| Engineering feedback reaches swarm without leaking suite scores | **Supported** — harness_self_check=1008; Encoding closed; ACTION_ERRORS path exercised via integration-fix×42 |
| Longer wall alone closes last ~4pp to 90% | **Unsupported here** — late plateau ~84–85% with continuing leaf churn |
| Absolute quality ≥90% on TOML | **Not yet** — 86.0% |

## 7. Conclusion

- Success bar full≥90%: **FAIL** (86.0%)
- \|holdout gap\| &lt; 5pp: **PASS** (−4.9; holdout higher)
- zero-pass observe = 0: **PASS**
- Eng-feedback arm vs v13.3b: **SLIGHTLY STRONGER EFFICIENCY** — better/equal quality in less wall; remaining gap is Spec Examples / key-table semantics / string edge rejects, not Encoding.

Next levers: focused Spec Examples + Keys/Strings invalid-reject work (still hidden grader). Do not expect empty wall extension past the plateau to buy much.

Compare command:

```bash
npm run compare -- runs/run-swarm-toml-v13.3b/metrics.json runs/run-swarm-toml-v13.3c/metrics.json
```
