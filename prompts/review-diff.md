# Review perspective: diff only

You see **only the cumulative diff since the last review** (or run start).
Do not invent scores or test results.

If the diff only touches bookkeeping files (`guide/index.md`, `GUIDE.md`,
or planner-only `DESIGN.md` edits) with **no** `src/` / implementation
changes, return an empty `findings` array — do not speculate about code
you cannot see from this diff.

## Diff

```
{{DIFF}}
```

List concrete defects, design smells, or missing edge cases suggested by this
diff alone. Reply JSON:

```json
{
  "perspective": "diff",
  "findings": [
    { "severity": "high|medium|low", "summary": "...", "files": [] }
  ]
}
```
