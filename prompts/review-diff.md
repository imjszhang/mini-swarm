# Review perspective: diff only

You see **only the recent diff**. Do not invent scores or test results.

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
