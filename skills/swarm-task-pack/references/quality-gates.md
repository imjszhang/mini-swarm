# Acceptance checklist & known failure modes

## Checklist (all must pass before delivering the pack)

Import & data:

- [ ] `npm run task:{id}:import` runs clean; re-running produces byte-identical
      `examples.json` / `sections.json` / `spec.txt` (idempotent).
- [ ] `examples.json`: several hundred entries; unique stable ids; every entry's
      `section` exists in `sections.json`; valid and invalid cases both present.
- [ ] Every section has ≥4 examples (holdout skips smaller groups); flag any
      section below 8.
- [ ] Every `sections.json` name appears as `## {name}` in `spec.txt`
      (spec-toc drops sections that don't).

Spec quality:

- [ ] Each section embeds ~5 valid + ~2 invalid fence examples; fences parse
      (spot-check with `parseEmbeddedExamples` via a small node one-liner).
- [ ] Embedded examples are **curated** (explicit id list in the gen-spec
      script), with ≥2 counterintuitive cases per section — never a prefix
      slice of the oracle.
- [ ] Behavior-equivalence-class review done: per section, each class the
      oracle exercises (valid AND invalid) maps to a prose sentence.
- [ ] Invalid-behavior rules stated in prose, not only implied by ERROR examples.
- [ ] Intro states CLI contract + "do not consult examples.json".
- [ ] Reference implementation (if available) passes 100% of embedded examples;
      otherwise ≥20 randomly sampled fences hand-verified.

Wiring:

- [ ] `npm run swarm:{id}:mock` completes: skeleton compiles, canary exit 0,
      embedded self-check executes, run finalizes with a score line.
- [ ] Reference implementation dropped into a workspace scores its known suite
      pass rate through `scorer/score.mjs` (calibrates the comparator).
- [ ] `npm run swarm:{id}:smoke` (short real run): planner decomposes along your
      sections; at least one leaf merges; no `ACTION_ERRORS` about spec sections.
- [ ] Diff is limited to `tasks/{id}/`, `task-pack.mjs`, `workspace.mjs`,
      comparator files (if touched), `package.json`, README mention.

## Known failure modes (from toml-json / commonmark experience)

1. **Oracle leak** — copying oracle cases into prompts/guides beyond the
   per-section embedded budget. Invalidates the benchmark. The only oracle→agent
   channel is the generated spec.txt fences.
2. **Invalid-rule starvation** — oracle rich in must-reject cases but spec prose
   never states the rejection rules. Workers plateau (TOML stuck at 86% while
   CommonMark hit 99%: the diff was error-behavior description density).
3. **Skeleton doesn't pass its own canary** — every merge health check fails from
   round one and the run thrashes. The stub must handle the canary input before
   any worker touches it.
4. **Comparator mismatch** — scorer says fail on semantically-equal output
   (key order, trailing newline, float formatting). Calibrate with a reference
   implementation before any real run; fix `compareCliOutput` + `scorer/score.mjs`.
5. **Section imbalance** — one giant section (e.g. "Strings" with 40% of cases)
   serializes the planner and concentrates merge conflicts. Split it in the
   import script's section mapping.
6. **Unstable example ids** — ids derived from array index or unsorted dir walk
   break holdout resume. Derive ids from source file paths.
7. **Shared-file hotspots in the skeleton** — if every worker must edit one
   dispatch table, merge conflicts dominate. Provide registry modules per domain
   concept so additions are append-only in separate files.
8. **Endless audits / no stop** — pack-agnostic since v13.4 convergence stops,
   but keep planner prompt audit rules intact when copying prompts (failure mode
   observed in the 13.3c commonmark run).
9. **Valid-semantics starvation** — prose covers rejection rules but omits
   counterintuitive *valid* behaviors. sqlite-micro v1 plateaued at 97.6%:
   INTEGER affinity keeping non-integer text as-is, `CAST('abc' AS INTEGER)=0`,
   scalar `min`/`max` propagating NULL, `"KEY"` as plain identifier — none
   stated in prose, and all 18 final misses were outside the embedded-example
   window, so no feedback loop (self-check, audit, canary) ever saw them.
   Workers guessed the intuitive-but-wrong semantics. Fix: behavior-class
   coverage + curated counterintuitive embedded examples (see
   `pack-tuning.md`).
10. **Subagent knowledge evaporation** — the agent who authored oracle inputs
    saw every surprising reference-implementation output, but spec prose was
    written by a different agent with no handoff; the surprise list died at
    the boundary. Require the same author for inputs and prose, or a
    per-section "surprises memo" passed between them.
