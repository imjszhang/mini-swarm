# Experiments log

## Protocol

- **Run A (bare)**: `npm run run:quick -- --run-id=run-a-bare`
- **Run B (coordinated)**: `npm run run:quick:coordinated -- --run-id=run-b-coordinated`
- **Serial minimal loop**: `npm run run:serial -- --quick --run-id=run-a-serial-quick`
- **Compare**: `node orchestrator/compare-runs.mjs runs/run-a-bare/metrics.json runs/run-b-coordinated/metrics.json`

## Runs

| Run ID | Mode | Coordination | Notes |
|---|---|---|---|
| run-a-serial-quick | serial, 3 tasks | false | Phase 4 minimal loop |
| run-a-bare | quick, concurrency 2 | false | Phase 7 Run A |
| run-b-coordinated | quick, concurrency 2 | true | Phase 7 Run B |

Fill metrics after each run completes.
