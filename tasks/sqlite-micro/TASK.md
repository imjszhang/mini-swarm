# Task pack: sqlite-micro

## Goal

Build a **micro-SQL engine** (SQLite Tier-1 subset) in TypeScript. CLI contract:

```bash
node dist/cli.js   # stdin = SQL script (statements end with ;)
# valid   → exit 0, stdout = last SELECT as JSON row-array (e.g. [[1,"a"]])
#           or [] if the script has no SELECT
# invalid → exit ≠ 0
```

## Scope

- **In**: in-memory single database; CREATE TABLE (name + type only); INSERT;
  single-table SELECT (projection, WHERE, ORDER BY, LIMIT/OFFSET, DISTINCT);
  UPDATE; DELETE; arithmetic/comparison/logical ops; BETWEEN/IN/LIKE; NULL
  three-valued logic; CASE; CAST/affinity; string/numeric scalar functions;
  aggregates without GROUP BY.
- **Out**: JOIN, GROUP BY/HAVING, subqueries, views, indexes, transactions,
  PRAGMA/ATTACH, BLOB, datetime functions, window functions, collation,
  column constraints; score feedback to agents.

## Hidden grader

Agents see `spec/spec.txt` section text (embedded examples only). They must
**not** read `spec/examples.json` or ask for suite pass/fail scores. Harness
suite scoring is observation-only. Engineering gates (build, canary, harness
checks on those same embedded examples) still apply.

## Canary

After merge, harness feeds `SELECT 1;\n` and requires exit 0 with stdout `[[1]]`.

## Oracle

Import: `npm run task:sqlite:import` → `spec/examples.json` + `spec/sections.json`
+ `spec/spec.txt`.

Oracle source: **Node.js built-in `node:sqlite` (Node v24) differential generation**
from `scripts/inputs/*.mjs`. Not an upstream suite pin. Expected values are never
hand-authored.

## Fidelity note (vs S-A-008 SQLite experiment)

This pack reproduces the *experiment shape* of Cursor's SQLite swarm (spec-only
input + hidden sqllogictest-style oracle + observe curves), not the full scale:

- Tier-1 micro subset ≠ 835-page SQLite handbook
- TypeScript ≠ Rust
- Cheap model stack (planner + fast workers) — goal is to measure the plateau,
  not to match a 4-hour 80% Opus/Fable run
