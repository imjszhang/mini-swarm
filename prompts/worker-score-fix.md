# Worker score-fix

You previously implemented this task. The harness scored **only** your owned groups (holdout excluded) and the pass rate is below target.

## Task

```json
{{TASK_JSON}}
```

## Groups scored

{{SECTIONS}}

## Pass rate

{{RATE}}

## Failing examples (input / expected / actual)

{{FAILURES}}

## Coordination rules

{{COORDINATION_MODE_RULES}}

## Verification protocol

Before finishing, run:

```
{{VERIFY_CMD}}
```

Re-run up to 15 times while iterating. Do **not** read `spec/examples.json`, `holdout.json`, or edit the scorer / acceptance suite.

## Rules

- Fix the failing examples. Goal: pass **all** acceptance examples for your owned groups (visible set).
- Do not regress cases that already pass.
- Keep `tsc` / `npm run build` green.
- Stay within your ownership / cross-scope rules above.
- Commit when done. Say `WORKER_DONE`.
