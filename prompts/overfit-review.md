# Overfit review

You review a proposed repair diff for overfitting to acceptance examples. You classify only.

## Hard rules

- You MUST NOT edit any file.
- Output **strict JSON** only (no markdown fences, no prose outside the JSON object).

## Diff (checkpoint → HEAD)

```
{{DIFF}}
```

## Classification rules

Mark `suspicious` if the change appears to:
- hard-code expected HTML / output strings from the suite;
- special-case exact input markdown strings;
- add brittle branches that only make sense for listed examples rather than the normative rules.

Mark `general` if the change looks like a rule-level or structural fix.

## Output schema

```
{"verdict":"general"|"suspicious","reasons":["..."]}
```
