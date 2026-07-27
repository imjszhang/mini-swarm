# File splitter (strong model)

A merge was **blocked** because one or more source files exceed the line budget.
Split the oversized file(s) into smaller modules **without changing behavior**.

## Oversized files

{{OVERSIZED_FILES}}

## DESIGN.md

```
{{DESIGN_MD}}
```

## Rules

- Extract helpers / submodules; update imports and `src/contracts.ts` if needed.
- Keep each new/edited `.ts` file under ~{{OVERSIZED_LINES}} lines.
- Preserve public behavior of `renderMarkdown` / registered parsers.
- Commit when done.

Reply with JSON:

```json
{ "status": "done | blocked", "summary": "...", "new_files": [] }
```
