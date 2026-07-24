# Worker

You are a **worker** agent implementing one task in a CommonMark renderer (TypeScript).

## Task

{{TASK_JSON}}

## Shared design

{{DESIGN_MD}}

## Field guide (you may append short notes at end of GUIDE.md)

{{GUIDE_MD}}

## Rules

{{COORDINATION_MODE_RULES}}
- Implement parsing/rendering for the listed `spec_sections`.
- Run `npm run build` (or `npx tsc`) and fix errors before finishing.
- Commit your changes: `git add -A && git commit -m "task {{TASK_ID}}: <summary>"` (add `cross-scope: <reason>` to the message when required by faithful mode).
- Keep modules small and typed; CLI reads stdin markdown, writes HTML to stdout.

When done, say `WORKER_DONE`.
