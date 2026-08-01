# Report: run-swarm-sqlite-v2

Generated: 2026-08-01T14:09:26.580Z

## 1. Experiment metadata

| Field | Value |
|---|---|
| task_pack | sqlite-micro |
| run_id | run-swarm-sqlite-v2 |
| protocol | hidden-grader swarm v13.3; run_to_done=true |
| concurrency | n/a |
| models | planner/worker from config (see agent_calls) |
| started / finished | 2026-08-01T10:44:11.764Z / 2026-08-01T12:51:54.924Z |
| segments | 1 |
| active wall (min) | 127.7 |
| stop reason | planner_done |
| finalized / salvaged | true / false |

## 2. Core metrics

| Metric | Value |
|---|---|
| leaf done / total | 77 / 175 (44.0%) |
| task time mean / p50 / max (min) | 7.63 / 6.17 / 25.21 |
| tokens in+out (+cache) | 12,018,205 (+0) across 200 calls |
| wall (active min) | 127.7 |
| effective_parallelism | 7.51 |

## 3. Quality

| Score | Value |
|---|---|
| full | 99.5% (738/742) |
| visible | 99.5% (625/628) |
| holdout | 99.1% (113/114) |
| holdout_gap_pp | 0.4 |
| overfit_alarm | false |

### Weak sections (by misses)

| Section | missed | rate |
|---|---|---|
| Numeric Functions | 3/39 | 92.3% |
| Null Logic | 1/39 | 97.4% |

### Failure buckets (from scored failure sample)

| Bucket | Count |
|---|---|
| total failure_count | 4 |
| valid output mismatch (sample) | 4 |
| invalid accepted (sample) | 0 |
| other (sample) | 0 |

## 4. Process health

| Signal | Value |
|---|---|
| merge_conflict_count | 7 |
| zero-pass observe windows | 0 |
| planner_parse_failures | 0 |
| planner_rounds | 24 |
| self_check_total | 868 |
| reviews | 14 |

### Conflict hotspots

| File | conflicts |
|---|---|
| src/executor/select.ts | 6 |
| src/parser/select.ts | 4 |
| src/affinity.ts | 3 |
| src/compare.ts | 3 |
| src/eval/comparison.ts | 3 |
| src/parser/create_table.ts | 3 |
| src/parser/insert.ts | 3 |
| src/functions/string.ts | 3 |

## 5. Baseline compare

Baseline: `run-swarm-sqlite-v1` (CommonMark v13.3 unless overridden).

| Metric | run-swarm-sqlite-v2 | run-swarm-sqlite-v1 |
|---|---|---|
| task_pack | sqlite-micro | sqlite-micro |
| full | 99.5% | 97.6% |
| visible | 99.5% | 97.5% |
| holdout | 99.1% | 98.2% |
| conflicts | 7 | 24 |
| zero-pass observe | 0 | 0 |
| active wall min | 127.7 | 230.7 |
| self_check | 868 | 1295 |

## 6. Conclusion

- Success bar full≥90%: **PASS** (99.5%)
- holdout gap &lt; 5pp: **PASS** (0.4)
- zero-pass observe = 0: **PASS**
- Migration proposition (high platform + healthy process on second sample): **SUPPORTED**

Compare command:

```bash
npm run compare -- runs/run-swarm-sqlite-v1/metrics.json runs/run-swarm-sqlite-v2/metrics.json
```

## 7. Failure autopsy (4 misses)

Verified against Node `node:sqlite` (same oracle as the pack). Pack-tuning v2 cleared all 18 v1 misses (Cast/Affinity, quoted keywords, scalar min/max NULL, DISTINCT NULL order). Residue:

### Numeric Functions (3) — `round` half-away-from-zero

| id | SQLite truth | Swarm actual |
|---|---|---|
| `numeric-functions-030` | `round(-2.5)` → **−3** | **−2** (JS `Math.round` / half-toward-+∞) |
| `numeric-functions-004` | `round(-3.5)` → **−4** | **−3** |
| `numeric-functions-023` | `AVG(round(v))` → **1.5** (uses −4 for −3.5) | **1.75** (cascade) |

Root cause: SQLite `round` uses half away from zero at `.5`; common JS rounding does not. Spec prose mentions round but not the half-away rule — candidate for pack-tuning v3 (A+B).

### Null Logic (1) — concat with NULL

| id | SQLite truth | Swarm actual |
|---|---|---|
| `null-logic-027` | `NULL \|\| '!'` → **null** | **`"!"`** (treated NULL as empty string) |

Root cause: `||` must propagate NULL (any NULL operand → NULL), not coerce to `""`. Likely under-stated next to other NULL rules — pack-tuning v3 A+B.

### Pack-tuning outcome vs v1

| Class (v1) | v2 result |
|---|---|
| INTEGER affinity / CAST→0 / REAL typeof | **cleared** (Cast And Affinity 39/39) |
| Scalar min/max NULL | **cleared** |
| Quoted keyword identifiers | **cleared** (Literals 39/39) |
| NULL sorts first ASC | **cleared** (Distinct 39/39) |

