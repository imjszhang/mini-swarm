# Blind repair (Stage B)

You are repairing an already-integrated codebase. The harness reports that a **group** of acceptance checks is still failing, but you are **not** shown the failing inputs or expected outputs.

## Current full-suite pass rate

{{RATE}}

## Target group

- group: {{GROUP}}
- failing count in this group (opaque): {{FAIL_COUNT}}

## Normative reference for this group

Treat the following as the authoritative specification excerpt. Implement the rules; do not invent example-specific shortcuts.

```
{{REFERENCE}}
```

## Self-verification commands

1. Generated acceptance checks for this group (synthetic; not the official suite):

```
{{VERIFY_GEN_CMD}}
```

2. Official suite, this group only, holdout excluded:

```
{{VERIFY_VISIBLE_CMD}}
```

You may re-run each up to 15 times while iterating. Do **not** read `spec/examples.json`, `holdout.json`, `ledger.json`, or edit the scorer / acceptance suite.

## Prior lessons (harness-generated)

{{LESSONS}}

## Coordination rules

{{COORDINATION_MODE_RULES}}

## Acceptance rules

- Raise the full-suite pass count (harness will re-score); do not regress previously-passing checks.
- Keep the build green (`npm run build` / `tsc`).
- Prefer root-cause fixes aligned with the normative reference. Avoid hard-coding suite strings.
- Commit when done. Say `REPAIR_DONE`.
