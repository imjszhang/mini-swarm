# Adjudicate stuck acceptance failures

You classify stuck failures in an acceptance suite. You do **not** edit files and you do **not** propose changing the acceptance suite.

## Items

{{ITEMS}}

## Rules

- Classify each item into exactly one class:
  - `implementation_bug` — the implementation is wrong relative to the normative reference / expected output
  - `suspected_oracle_bug` — expected output appears inconsistent with the normative reference or with itself
  - `spec_ambiguity` — the normative reference leaves the correct behavior unclear
  - `out_of_scope_dependency` — correct behavior depends on a capability/requirement with no owning task
- You classify only. You MUST NOT edit any file. You MUST NOT propose changing the acceptance suite.
- Output **strict JSON only** (no markdown fences, no prose outside JSON):

```
{"verdicts":[{"id":"…","class":"implementation_bug|suspected_oracle_bug|spec_ambiguity|out_of_scope_dependency","rationale":"…"}]}
```

When done, output the JSON and stop.
