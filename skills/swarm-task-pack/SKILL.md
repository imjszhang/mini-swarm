---
name: swarm-task-pack
description: Turn a candidate task into a runnable mini-swarm task pack. Use when the user wants to add a new task/benchmark to mini-swarm, asks whether a task is suitable for the swarm, or needs to produce the three swarm inputs — a normative spec, a hidden oracle test suite, and the harness wiring (skeleton/prompts/canary/registration).
---

# swarm-task-pack — build a task pack for mini-swarm

You are turning a candidate task into a complete pack under `tasks/{id}/` that
`npm run swarm -- --task={id}` can execute. A pack is three things:

1. **Spec** — normative text the agents read (`spec/spec.txt` + `spec/sections.json`).
2. **Hidden oracle** — the scoring suite agents never see (`spec/examples.json`).
3. **Environment** — skeleton, prompts, canary, and registration in the orchestrator.

Work through the phases **in order**. Each phase ends with a gate; do not continue
past a failed gate. Reference files (read on demand, not upfront):

- `references/spec-format.md` — exact file formats (examples.json schema, fence syntax, holdout rules)
- `references/pack-registration.md` — every code touchpoint in the orchestrator
- `references/quality-gates.md` — acceptance checklist + known failure modes
- `templates/TASK.md` — pack charter template

The existing pack `tasks/toml-json/` is the canonical worked example; diff against
it whenever unsure.

## Phase 0 — Eligibility gate (be willing to say no)

Answer three questions with evidence, not optimism:

1. **Precise intent?** Can the task be written as a frozen, self-contained normative
   spec (like a language spec or RFC)? "Build something nice" fails; "implement
   TOML v1.0 decoding to tagged JSON" passes.
2. **Machine-checkable output?** Is there a deterministic CLI contract
   (stdin → stdout + exit code) whose correctness a program can judge with no
   human in the loop? Subjective quality (prose style, UI look) fails.
3. **Decomposable?** Does the spec split into 10+ sections with low coupling, so
   parallel workers rarely edit the same lines? A single tightly-wound algorithm
   (one 500-line function) fails even if 1 and 2 pass.

**Gate:** if any answer is no, stop and tell the user the task is not swarm-suitable,
which question failed, and (if possible) how to reshape it. A confident rejection is
a successful outcome of this skill.

## Phase 1 — Oracle first (before any spec writing)

Find the judge before writing the textbook. Priority order:

1. **Authoritative test suite** (best): e.g. `toml-test`, CommonMark `spec.txt`
   examples, WPT. Vendor it under `tasks/{id}/vendor/` with a pinned version.
2. **Reference implementation** (good): generate expected outputs by running a
   trusted implementation over curated inputs. Record the tool + version.
3. **Hand-built cases** (last resort): only for small, closed tasks; expect low
   coverage and say so.

Write an idempotent import script `tasks/{id}/scripts/import-*.mjs` that emits
`spec/examples.json` + `spec/sections.json` (schema in `references/spec-format.md`).

**Gate:** several hundred examples minimum; both positive and negative (must-reject)
cases; every section with ≥4 examples (smaller groups get no holdout — see
spec-format). **Red line: never invent expected outputs yourself.** If no independent
authority exists for the expected output, go back to Phase 0 and reject.

## Phase 2 — Spec (this sets the score ceiling)

Produce `spec/spec.txt` from the authoritative source text (not from the oracle).
Quality bars, learned from the TOML-86% vs CommonMark-99% gap:

- Split into `## {Section}` headings that exactly match `sections.json` entries.
- Every section embeds runnable examples in the 32-backtick `example` fence format
  (input, a line containing only `.`, expected output or the literal `ERROR`).
  Target ≥5 valid + ≥2 invalid per section.
- **Check invalid-behavior prose density.** Workers can only learn rejection rules
  that the spec states. If the oracle has invalid cases whose rule appears nowhere
  in the spec text, workers will plateau. Enumerate rejection rules explicitly.
- The intro must state the CLI contract (stdin/stdout/exit codes) and the
  fence-format convention, and must tell agents not to consult `examples.json`.

Prefer a generator script (`scripts/gen-spec-txt.mjs` pattern) over hand-writing,
so the spec can be rebuilt when the oracle import changes.

**Gate:** a trusted reference implementation passes 100% of the embedded examples.
If you have no reference implementation, manually verify a random sample of ≥20.

## Phase 3 — Environment wiring

All touchpoints are enumerated in `references/pack-registration.md`. Summary:

1. **Skeleton** — compilable TypeScript stub in `orchestrator/lib/workspace.mjs`
   (`initSwarmSkeleton` branch): `src/cli.ts` implementing the CLI contract,
   `src/contracts.ts` as compile-checked seams, registries that let parallel
   workers add parsers without touching shared files. The skeleton must already
   pass the canary.
2. **Canary** — a minimal valid input for post-merge health checks (e.g. `a = 1\n`).
3. **Output comparator** — if equality is not exact-text, extend
   `compareCliOutput` in `orchestrator/lib/spec-embedded-check.mjs` and the
   comparator in `scorer/score.mjs` (e.g. key-order-insensitive JSON).
4. **Prompts** — copy `tasks/toml-json/prompts/swarm-{planner,worker}.md`, edit
   only task-specific paragraphs (goal, CLI contract, domain hints). Keep the
   audit/convergence rules intact.
5. **Registration** — add the pack to `orchestrator/lib/task-pack.mjs`
   (`listTaskPackIds` + `resolveTaskPack`), and npm scripts
   `task:{id}:import`, `swarm:{id}:mock`, `swarm:{id}:smoke`, `swarm:{id}:detached`.
6. **Charter** — write `tasks/{id}/TASK.md` from `templates/TASK.md`.

## Phase 4 — Acceptance gates

Run the checklist in `references/quality-gates.md`. Do not hand the pack to the
user until all of these hold:

1. `npm run task:{id}:import` is idempotent (re-run produces identical files).
2. `npm run swarm:{id}:mock` completes: skeleton builds, canary passes,
   embedded self-checks execute.
3. Reference implementation (if any) scores its known pass rate via the scorer.
4. A short real smoke run (`swarm:{id}:smoke`) shows planner decomposition along
   your sections and at least one merged leaf.
5. `git status` shows only `tasks/{id}/`, the registration diffs, and npm scripts.

## Red lines — hidden-grader discipline

You, the pack author, can see the answers. The swarm agents must not.

- `examples.json` is **never** read by any agent-facing code path. Spec embedded
  examples are a small curated subset, regenerated via script — not a mirror.
- Do not copy oracle cases into prompts, worker hints, or guide text beyond the
  embedded-example budget in spec.txt.
- Do not encode "the grader emphasizes X" style hints derived from oracle
  distribution. If X matters, state the *rule* in the spec prose instead.
- Scores (suite pass rates) are harness observation only; they never enter any
  agent prompt. Do not add code that leaks them.

Violating these turns the benchmark into a memorization test and invalidates every
experiment run on the pack.
