# Review perspective: codebase snapshot

You see **only a snapshot of the current source tree** (no diff, no scores).

## Tree listing

```
{{TREE_LISTING}}
```

## Key file excerpts

{{FILE_EXCERPTS}}

Find structural problems: god files, missing wiring, inconsistent interfaces,
dead stubs. Reply JSON:

```json
{
  "perspective": "codebase",
  "findings": [
    { "severity": "high|medium|low", "summary": "...", "files": [] }
  ]
}
```
