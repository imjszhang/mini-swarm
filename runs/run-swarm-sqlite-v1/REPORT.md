# Report: run-swarm-sqlite-v1

Generated: 2026-08-01T09:18:21.452Z

## 1. Experiment metadata

| Field | Value |
|---|---|
| task_pack | sqlite-micro |
| run_id | run-swarm-sqlite-v1 |
| protocol | hidden-grader swarm v13.3; run_to_done=true |
| concurrency | n/a |
| models | planner/worker from config (see agent_calls) |
| started / finished | 2026-08-01T05:21:45.485Z / 2026-08-01T09:12:30.121Z |
| segments | 1 |
| active wall (min) | 230.7 |
| stop reason | idle_tree |
| finalized / salvaged | true / false |

## 2. Core metrics

| Metric | Value |
|---|---|
| leaf done / total | 131 / 307 (42.7%) |
| task time mean / p50 / max (min) | 8.89 / 7.75 / 29.98 |
| tokens in+out (+cache) | 15,071,397 (+0) across 335 calls |
| wall (active min) | 230.7 |
| effective_parallelism | 8.23 |

## 3. Quality

| Score | Value |
|---|---|
| full | 97.6% (724/742) |
| visible | 97.5% (612/628) |
| holdout | 98.2% (112/114) |
| holdout_gap_pp | -0.8 |
| overfit_alarm | false |

### Weak sections (by misses)

| Section | missed | rate |
|---|---|---|
| Cast And Affinity | 8/39 | 79.5% |
| Numeric Functions | 6/39 | 84.6% |
| Literals And Identifiers | 3/39 | 92.3% |
| Distinct | 1/39 | 97.4% |

### Failure buckets (from scored failure sample)

| Bucket | Count |
|---|---|
| total failure_count | 18 |
| valid output mismatch (sample) | 15 |
| invalid accepted (sample) | 0 |
| other (sample) | 3 |

## 4. Process health

| Signal | Value |
|---|---|
| merge_conflict_count | 24 |
| zero-pass observe windows | 0 |
| planner_parse_failures | 0 |
| planner_rounds | 40 |
| self_check_total | 1295 |
| reviews | 24 |

### Conflict hotspots

| File | conflicts |
|---|---|
| src/engine/eval.ts | 9 |
| src/executor/select.ts | 7 |
| src/parser/expr.ts | 5 |
| src/engine/aggregates.ts | 5 |
| src/engine/nulls.ts | 2 |
| src/parser/expr_atom.ts | 2 |
| DESIGN.md | 1 |
| src/functions/bootstrap.ts | 1 |

## 5. Baseline compare

Baseline: `run-swarm-v13.3` (CommonMark v13.3 unless overridden).

| Metric | run-swarm-sqlite-v1 | run-swarm-v13.3 |
|---|---|---|
| task_pack | sqlite-micro | commonmark |
| full | 97.6% | 98.1% |
| visible | 97.5% | 97.7% |
| holdout | 98.2% | 100.0% |
| conflicts | 24 | 39 |
| zero-pass observe | 0 | 0 |
| active wall min | 230.7 | 278.7 |
| self_check | 1295 | 2376 |

## 6. Conclusion

- Success bar full≥90%: **PASS** (97.6%)
- holdout gap &lt; 5pp: **PASS** (-0.8)
- zero-pass observe = 0: **PASS**
- Migration proposition (high platform + healthy process on second sample): **SUPPORTED**

Compare command:

```bash
npm run compare -- runs/run-swarm-v13.3/metrics.json runs/run-swarm-sqlite-v1/metrics.json
npm run compare -- runs/run-swarm-toml-v13.3c/metrics.json runs/run-swarm-sqlite-v1/metrics.json
```

## 7. Failure autopsy (18 misses)

Verified against Node `node:sqlite` (same oracle as the pack).

### Cast And Affinity (8)

Root cause: **INTEGER column affinity and CAST failure semantics** under-implemented.

| Bug | SQLite truth | Swarm actual |
|---|---|---|
| INSERT `'7.9'` into INTEGER | keeps **7.9** (real) — only *integer-looking* text converts | stored as **7** |
| INSERT `'abc'` into INTEGER | keeps **`'abc'`** (text) | stored as **0** |
| `CAST('abc' AS INTEGER)` | **0** | **null** |
| Downstream | CAST-to-TEXT / AVG / arithmetic on wrong stored values cascade | 4 more mismatches |

### Numeric Functions (6)

| Bug | SQLite truth | Swarm actual |
|---|---|---|
| scalar `min(5, NULL)` / `max(5, NULL)` | **NULL** | returned the non-null arg (`5`) |
| `typeof(0.0)` | `"real"` | `"integer"` |
| Filters using those | 2 extra row / WHERE mismatches | cascade |

### Literals And Identifiers (3)

Quoted keyword aliases `AS "from"` / `"where"` / `"order"` rejected as “FROM/WHERE/ORDER not supported” — tokenizer/parser treated the quoted identifier as a statement keyword.

### Distinct (1)

`SELECT DISTINCT v … ORDER BY v` with NULL + `'a'`: SQLite orders NULL first; swarm ordered NULL last.

### Spec prose gap (actionable for pack v2)

Cast And Affinity prose should explicitly state: (1) INTEGER affinity converts only if the entire text is an integer literal — otherwise the original type is retained; (2) `CAST(x AS INTEGER)` of non-numeric text yields **0**, not NULL. Numeric Functions prose should state scalar `min`/`max` propagate NULL.

