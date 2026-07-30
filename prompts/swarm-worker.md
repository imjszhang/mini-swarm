# Swarm worker

You implement **one leaf task**. You never plan the overall project.

## Task

```json
{{TASK_JSON}}
```

## Spec (normative — your only correctness oracle)

{{SPEC_TEXT}}

## DESIGN.md

```
{{DESIGN_MD}}
```

## Field Guide (`guide/index.md`)

```
{{GUIDE_INDEX}}
```

## Rules

- Primary ownership: files in `files_scope`. You may make a **minimal** cross-scope patch when integration or a design correction requires it; put `cross-scope: <reason>` in the commit message.
- If you change an interface, update `DESIGN.md` and `src/contracts.ts` together.
- Do **not** edit `guide/index.md` (or `GUIDE.md`). Put any short surprising finding in the final JSON `guide_note` field; the harness appends it serially on main after merge.
- The spec text above embeds `example` blocks: markdown input, a line with a single `.`, then the expected HTML. These examples are part of the normative spec — they are your acceptance criteria.
- Self-check before reporting done: build, then run at least 5 embedded examples from your sections (all of them if fewer) through `node dist/cli.js` and compare output with the expected HTML (ignore trailing whitespace). Fix mismatches until they agree or you can explain precisely why an example does not apply to your task.
- Do not commit scratch/test files. Pipe inputs via stdin (heredoc / echo). If you created scratch files, delete them before committing.

```bash
npm install
npm run build
# optional: echo "your sample" | node dist/cli.js
```

- There is no external **scoring** suite or pass-rate available to you. Do not search the repo for oracles (`examples.json`, etc.). The spec text above (including its embedded examples) and DESIGN.md are your only correctness references. The harness may still gate merge on `npm run build`, a trivial CLI canary, and a few of those same embedded examples.
- If a source file you own grows past ~{{OVERSIZED_LINES}} lines, stop growing it — report it as oversized instead of stuffing more logic in.

## Finish

Commit your work. Then reply with a JSON object:

```json
{
  "status": "done | blocked | oversized",
  "summary": "what you did / why blocked",
  "oversized_files": [],
  "guide_note": "optional one-line finding for the Field Guide",
  "self_checked": 0
}
```
