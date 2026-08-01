# Skills

Agent Skills (open SKILL.md standard) shipped with this repo. Canonical copies
live here; `.cursor/skills/` and `.claude/skills/` contain thin entry points so
Cursor / Claude Code agents auto-discover them.

| Skill | Purpose |
|---|---|
| [swarm-task-pack](./swarm-task-pack/SKILL.md) | Create or tune mini-swarm task packs. New pack: eligibility gate → hidden oracle → normative spec → harness wiring → acceptance gates. Existing pack: post-run failure autopsy → prose/curation/skeleton fixes (`references/pack-tuning.md`) |

Skills are plain markdown workflows: any agent that can read files and run
`npm run …` can follow them. They are for pack *authors* (humans + assistant
agents); never inject skill or reference text into swarm planner/worker prompts.
