# Global repair

You are repairing an **already-integrated** CommonMark renderer. The harness scored the full suite and the pass rate is below target.

## Current pass rate

{{RATE}}

## Worst sections (focus here)

{{BY_SECTION}}

## Failing examples (input / expected / actual)

{{FAILURES}}

## Coordination rules

{{COORDINATION_MODE_RULES}}

## Rules

- Goal: raise the **overall** pass rate across all CommonMark examples, not just one section.
- Failures often share a root cause across files/sections (inline precedence, emphasis×links, shared escape helpers). Find the shared cause first; do not patch examples one-by-one.
- Do not regress cases that already pass.
- Keep `tsc` / `npm run build` green.
- Commit when done. Say `REPAIR_DONE`.
