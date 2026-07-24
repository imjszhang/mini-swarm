# Worker score-fix

You previously implemented this task. The harness scored **only** your `spec_sections` and the pass rate is below target.

## Task

```json
{{TASK_JSON}}
```

## Sections scored

{{SECTIONS}}

## Pass rate

{{RATE}}

## Failing examples (input / expected / actual)

{{FAILURES}}

## Coordination rules

{{COORDINATION_MODE_RULES}}

## Rules

- Fix the failing examples one by one. Goal: pass **all** CommonMark spec examples for your `spec_sections`.
- Do not regress cases that already pass.
- Keep `tsc` / `npm run build` green.
- Stay within your ownership / cross-scope rules above.
- Commit when done. Say `WORKER_DONE`.
