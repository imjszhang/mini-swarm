# Task pack: {id}

## Goal

Build a **{one-line product}** in TypeScript. CLI contract:

```bash
node dist/cli.js   # stdin = {input format}
# valid   → exit 0, stdout = {output format}
# invalid → exit ≠ 0
```

{Show the exact output shape with a minimal example.}

## Scope

- **In**: {what the suite covers; which upstream file list / version}.
- **Out**: {explicitly excluded features}; score feedback to agents.

## Hidden grader

Agents see `spec/spec.txt` section text (embedded examples only). They must
**not** read `spec/examples.json` or ask for suite pass/fail scores. Harness
suite scoring is observation-only. Engineering gates (build, canary, harness
checks on those same embedded examples) still apply.

## Canary

After merge, harness feeds `{canary input}` and requires exit 0.

## Oracle

Import: `npm run task:{id}:import` → `spec/examples.json` + `spec/sections.json`.
Vendor pin: `vendor/{source}` @ {tag/commit} ({what the pin covers}).
