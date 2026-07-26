# Cluster acceptance failures by root cause

You group failing acceptance examples into root-cause clusters for repair. You do **not** edit files.

## Failures

{{FAILURES}}

## Rules

- Propose at most {{MAX_CLUSTERS}} clusters.
- Each failing item id must appear in exactly one cluster.
- Prefer shared root causes over one-item clusters when evidence supports it.
- Output **strict JSON only** (no markdown fences, no prose outside JSON):

```
{"clusters":[{"cluster_id":"c1","hypothesis":"short root-cause hypothesis","item_ids":["…"]}]}
```

When done, output the JSON and stop.
