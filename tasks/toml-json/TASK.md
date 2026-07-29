# Task pack: toml-json

## Goal

Build a **TOML v1.0 decoder** in TypeScript. CLI contract:

```bash
node dist/cli.js   # stdin = TOML text
# valid   → exit 0, stdout = toml-test tagged JSON
# invalid → exit ≠ 0
```

Tagged JSON shape (toml-test):

```json
{ "a": { "type": "integer", "value": "42" } }
```

## Scope

- **In**: TOML 1.0 decoder; suite = `vendor/toml-test` file list `files-toml-1.0.0` (valid + invalid).
- **Out**: encoder; TOML 1.1 preview features; score feedback to agents.

## Zero test signal

Agents see `spec/spec.txt` section text (embedded examples only). They must **not** read `spec/examples.json` or ask for pass/fail scores. Harness scoring is observation-only.

## Canary

After merge, harness feeds `a = 1\n` and requires exit 0 (CLI starts and accepts minimal valid TOML).

## Oracle

Import: `npm run task:toml:import` → `spec/examples.json` + `spec/sections.json`.
Vendor pin: `vendor/toml-test` @ tag `v1.6.0` (TOML 1.0 test list).
