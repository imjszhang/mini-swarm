# Report: run-swarm-v13.3c

Generated: 2026-07-31T12:41:38.254Z

## 1. Experiment metadata

| Field | Value |
|---|---|
| task_pack | commonmark |
| run_id | run-swarm-v13.3c |
| protocol | hidden-grader swarm v13.3; run_to_done=true |
| concurrency | n/a |
| models | planner/worker from config (see agent_calls) |
| started / finished | 2026-07-31T04:59:26.727Z / 2026-07-31T12:41:32.634Z |
| segments | 1 |
| active wall (min) | 462.1 |
| stop reason | other |
| finalized / salvaged | true / true |

## 2. Core metrics

| Metric | Value |
|---|---|
| leaf done / total | 398 / 566 (70.3%) |
| task time mean / p50 / max (min) | 8.3 / 7.62 / 31.26 |
| tokens in+out (+cache) | 63,534,086 (+0) across 883 calls |
| wall (active min) | 462.1 |
| effective_parallelism | 9.13 |

## 3. Quality

| Score | Value |
|---|---|
| full | 99.4% (522/525) |
| visible | 99.5% (437/439) |
| holdout | 98.8% (85/86) |
| holdout_gap_pp | 0.7 |
| overfit_alarm | false |

### Weak sections (by misses)

| Section | missed | rate |
|---|---|---|
| Emphasis and strong emphasis | 2/132 | 98.5% |
| Code spans | 1/22 | 95.5% |

### Failure buckets (from scored failure sample)

| Bucket | Count |
|---|---|
| total failure_count | 3 |
| valid output mismatch (sample) | 3 |
| invalid accepted (sample) | 0 |
| other (sample) | 0 |

## 4. Process health

| Signal | Value |
|---|---|
| merge_conflict_count | 53 |
| zero-pass observe windows | 0 |
| planner_parse_failures | 0 |
| planner_rounds | 111 |
| self_check_total | 5526 |
| reviews | 77 |

### Conflict hotspots

| File | conflicts |
|---|---|
| src/render.ts | 19 |
| src/index.ts | 16 |
| src/blocks/blockquote.ts | 6 |
| src/blocks/list-item-continue.ts | 5 |
| src/blocks/list-item.ts | 4 |
| src/blocks/engine.ts | 3 |
| src/inline/parse.ts | 3 |
| src/blocks/preamble.ts | 2 |

## 5. Baseline compare

Baseline: `run-swarm-v13.3` (CommonMark v13.3 unless overridden).

| Metric | run-swarm-v13.3c | run-swarm-v13.3 |
|---|---|---|
| task_pack | commonmark | commonmark |
| full | 99.4% | 98.1% |
| visible | 99.5% | 97.7% |
| holdout | 98.8% | 100.0% |
| conflicts | 53 | 39 |
| zero-pass observe | 0 | 0 |
| active wall min | 462.1 | 278.7 |
| self_check | 5526 | 2376 |

## 6. Conclusion

- Success bar full≥90%: **PASS** (99.4%)
- holdout gap &lt; 5pp: **PASS** (0.7)
- zero-pass observe = 0: **PASS**
- Migration proposition (high platform + healthy process on second sample): **SUPPORTED**

Compare command:

```bash
npm run compare -- runs/run-swarm-v13.3/metrics.json runs/run-swarm-v13.3c/metrics.json
```

