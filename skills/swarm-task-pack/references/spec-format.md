# File formats: examples.json / sections.json / spec.txt

Ground truth lives in the orchestrator source; this file summarizes it. When in
doubt read `orchestrator/lib/spec-embedded-check.mjs`, `orchestrator/lib/holdout.mjs`,
`scorer/score.mjs`, and the toml-json import scripts.

## spec/examples.json — the hidden oracle

A JSON array. Entry schema (toml-json example):

```json
{
  "id": "invalid-array-double-comma-1",
  "section": "Arrays",
  "input": "double-comma-1 = [1,,2]\n",
  "expected": "",
  "expect_error": true,
  "markdown": "double-comma-1 = [1,,2]\n",
  "html": ""
}
```

- `id` — unique, stable across re-imports (derive from source path/name; lowercase,
  `[a-z0-9-]`). Holdout selection is keyed on ids, so id churn breaks resume.
- `section` — must be one of the names in `sections.json`. Scorer falls back to
  `group`, then `"default"`.
- `input` / `expected` — the CLI stdin and expected stdout. Scorer falls back to
  legacy `markdown` / `html` fields (`input ?? markdown`, `expected ?? html`);
  emit both pairs for compatibility, as the toml import does.
- `expect_error: true` — the CLI must exit non-zero; `expected` is `""`.

## spec/sections.json

A JSON array of section names, e.g. `["Comments", "Keys", "Strings", ...]`.

- Every name must appear in `spec.txt` as a literal `## {name}` heading —
  `orchestrator/lib/spec-toc.mjs` filters sections by `text.includes("## " + name)`.
- Sections are the planner's decomposition unit and the holdout stratification
  unit. Aim for 10–25 sections of comparable size.

## spec/spec.txt — the normative text agents read

Structure:

1. Intro: goal, CLI contract (stdin → stdout, exit-code semantics), embedded
   example fence convention, and an explicit "do not consult examples.json or
   external score signals" sentence.
2. One `## {Section}` block per sections.json entry: normative prose + embedded
   examples.

Embedded example fence — parsed by `parseEmbeddedExamples`:

- Opening line: 32 backticks, a space, the word `example`.
- Then the input lines.
- Then a line containing only `.` (first such line splits input/expected).
- Then the expected stdout. For must-reject cases the expected side is the single
  literal line `ERROR` (`expected.trim() === "ERROR"` ⇒ expect non-zero exit).
- Closing line: 32 backticks.

Generator pattern (`tasks/toml-json/scripts/gen-spec-txt.mjs`): pick ≤5 valid +
≤2 invalid oracle examples per section and emit fences. That per-section subset is
the *only* sanctioned oracle→spec leakage.

**Curate the picks.** The generator must accept an explicit id list per section
(fall back to a slice only for sections with no curated list). A bare
`slice(0, n)` surfaces only the trivial cases: in sqlite-micro v1, all 18 final
misses were outside the first-5 window, invisible to worker self-checks, audit
leaves, and the cross-section canary alike. Pin at least 2 counterintuitive
cases per section — the ones a reasonable implementer would get wrong.

## How the harness consumes these files

- **Embedded self-check (per-leaf gate):** samples up to `harnessSelfCheckExamples`
  (default 5) fences from the leaf's assigned sections, seeded per attempt, and runs
  them against the workspace CLI before merge.
- **Cross-section canary:** samples `harnessCrossCheckExamples` (default 5) fences
  from *other* sections to catch regressions.
- **Output comparison:** `compareCliOutput(actual, expected, packId)` — exact text
  (trailing-whitespace/newline normalized) by default; toml-json overrides with
  key-order-insensitive JSON compare. New packs with non-text equality must add a
  branch here **and** in `scorer/score.mjs`.
- **Holdout (`orchestrator/lib/holdout.mjs`):** stratified per `section`, seeded,
  default ratio 0.15. **Groups with fewer than 4 examples are skipped entirely** —
  such sections contribute nothing to the holdout signal. Prefer ≥8 examples per
  section.
- **Scoring:** suite pass rate over all examples (`expect_error` cases pass when
  exit ≠ 0). Observation-only; never fed back to agents.
