# Experiments log

## Protocol

- **Run A (bare)**: `npm run run:quick -- --run-id=run-a-bare`
- **Run B (coordinated)**: `npm run run:quick:coordinated -- --run-id=run-b-coordinated`
- **Serial minimal loop**: `npm run run:serial -- --quick --run-id=run-a-serial-quick`
- **Compare**: `node orchestrator/compare-runs.mjs runs/run-a-bare/metrics.json runs/run-b-coordinated/metrics.json`

## Runs

| Run ID | Mode | Coordination | Notes |
|---|---|---|---|
| run-a-serial-quick | serial, 3 tasks | false | 28.8% pass, 0 conflicts, 451 LOC |
| run-a-bare-v3 | quick, concurrency 2 | false | **19.6%** pass, 0 conflicts, 440 LOC |
| run-b-coordinated-v3 | quick, concurrency 2 | true | **19.6%** pass, **1** conflict, **195** LOC, GUIDE.md populated |

Fill metrics after each run completes.
