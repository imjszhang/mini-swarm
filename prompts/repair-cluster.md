# Repair cluster

You are repairing an already-integrated codebase. The harness scored the acceptance suite (holdout excluded) and selected one root-cause cluster to fix.

## Current visible pass rate

{{RATE}}

## Cluster

- id: {{CLUSTER_ID}}
- hypothesis: {{HYPOTHESIS}}

## Failing examples in this cluster (input / expected / actual)

{{FAILURES}}

## Normative reference (opaque excerpts)

{{REFERENCE}}

## Prior lessons (harness-generated)

{{LESSONS}}

## Self-verification command

Run this before finishing (holdout excluded; only this cluster's ids):

```
{{VERIFY_CMD}}
```

You may re-run it up to 15 times while iterating. Do **not** read `spec/examples.json`, `holdout.json`, or edit the scorer / acceptance suite.

## Coordination rules

{{COORDINATION_MODE_RULES}}

## Acceptance rules

- Raise overall visible pass count; do not regress any previously-passing example.
- Keep the build green (`npm run build` / `tsc`).
- Prefer fixing the shared root cause described by the hypothesis; avoid hard-coding expected strings from the suite.
- Commit when done. Say `REPAIR_DONE`.
