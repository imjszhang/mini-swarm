# Pack tuning — optimize an existing task pack from run results

Use after a real run finishes (`runs/{runId}/REPORT.md` + `metrics.json`).
Goal: convert the run's failure list into pack fixes without breaking
hidden-grader discipline. Case study: `run-swarm-sqlite-v1` (97.6% full; all
18 misses invisible to every feedback loop — see quality-gates failure mode 9).

## Inputs

- `metrics.json` → `final_score.failures` (complete when `failure_count`
  equals the listed length; otherwise re-score with a higher `--max-failures`)
- `REPORT.md` weak-section table
- The pack's oracle generator / reference implementation for verification

## Step 1 — Failure autopsy

For each failing case:

1. Reproduce the expected value against the reference implementation (e.g. a
   `node:sqlite` one-liner), so you know the authority is right and what the
   rule actually is.
2. State in one sentence what the swarm's engine did instead.
3. Group failures into **behavior equivalence classes** (e.g. "INTEGER affinity
   keeps non-integer text as-is" covers 4 cases). Fixes happen at class level,
   never case level.
4. Check visibility: were the failing ids inside the spec's embedded-example
   window? If none were, the swarm never had a feedback path — expect a
   curation fix in addition to a prose fix.

## Step 2 — Classify each class into a fix channel

| Channel | Symptom | Fix |
|---|---|---|
| **A. Prose gap** | correct behavior stated nowhere in spec text | add a rule sentence to the section's prose source |
| **B. Curation gap** | rule stated (or now added) but no embedded example exercises it; failing ids outside the embedded window | pin counterintuitive cases into the spec via an explicit id list in the gen-spec script |
| **C. Skeleton capacity gap** | implementing the rule requires changing core types / `contracts.ts` (e.g. value needs a storage-class tag) | extend the skeleton; cheap workers will not refactor contracts mid-run |
| **D. Oracle bug** | the expected value itself is wrong vs the upstream authority | fix the inputs and regenerate; document in TASK.md |

Most classes need **A + B together**: the rule sentence teaches; the pinned
example enforces (worker self-check, audit leaves, and cross-section canary all
sample from embedded examples — nothing else is visible to agents).

## Step 3 — Apply

- **Prose**: rule-level sentences only. Never paste oracle case text beyond the
  embedded-example quota; never enumerate per-case expected values in prose.
- **Curation**: extend the pack's gen-spec script to accept a curated id list
  per section. Keep the per-section quota unless widening is justified —
  widening is allowed (embedded examples are the sanctioned channel) but record
  it in TASK.md.
- **Skeleton**: must still compile and pass the canary; update the pack's
  check-skeleton script if core types changed.

## Step 4 — Re-verify (same gates as Phase 4)

1. import idempotent; spec size under the cap; fences parse
2. reference implementation passes 100% of embedded examples (including newly
   pinned ones)
3. mock run completes; orchestrator test suite green
4. diff confined to the pack (+ registration files if the skeleton changed)

## Step 5 — Re-run

- Use a **new run id** (`…-v2`). Never resume an old run against a changed
  spec — scores would not be comparable.
- Log in EXPERIMENTS.md which failure classes were fixed via which channel, so
  the next autopsy can distinguish regression from residue.

## Red line

Fixes must generalize. A "rule sentence" that merely restates one oracle case
is case-leaking in disguise. If you cannot phrase the fix as a general rule
that the upstream authority documents, treat it as channel D and re-examine
the oracle instead.
