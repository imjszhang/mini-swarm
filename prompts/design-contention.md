# Design — Contention Task Set (v8/v9)

Living design document for the high-contention CommonMark renderer swarm.
Workers that change an interface or design decision must update the relevant section here
and keep `src/contracts.ts` in sync (compile-checked).

## Module layout

```
src/
  index.ts              # parseMarkdown → AST → renderMarkdown HTML
  cli.ts                # stdin/stdout CLI
  types.ts              # BlockNode / InlineNode base types
  contracts.ts          # compile-checked public interfaces (faithful runs)
  render.ts             # renderNode(node) switch by node.type
  blocks/
    registry.ts         # registerBlockParser / getBlockParsers
    headings.ts         # ATX
    setext.ts           # Setext
    paragraphs.ts
    lists.ts
    blockquote.ts
    thematic.ts
    fenced.ts
    indented.ts
  inline/
    registry.ts         # registerInlineParser / getInlineParsers
    emphasis.ts
    codespan.ts
    links.ts
    text.ts             # escapes / hard+soft line breaks / tab expansion helpers
```

## Registration protocol

1. Each feature module exports a parser function matching the registry signature.
2. At module load (or from a small side-effect import), call `registerBlockParser` /
   `registerInlineParser` so the pipeline discovers the feature.
3. Add a matching `case` in `src/render.ts` for the node `type` string you invent.
4. Prefer stable `type` names: `heading`, `setext_heading`, `paragraph`, `list`,
   `blockquote`, `thematic_break`, `code_block`, `emphasis`, `strong`, `code_span`,
   `link`, `image`.
5. Container-block parsers (lists, blockquote) should recursively parse nested blocks
   via `getBlockParsers()` / the registry — not flatten children into plain text.

## Rendering protocol

- `render.ts` owns the top-level `switch (node.type)`.
- Nested inline content should call shared helpers if present; otherwise keep the
  smallest local helper inside your module and expose what `render` needs.

## Cross-scope patch protocol (faithful)

Primary ownership is your module file under `files_scope`.
Expected minimal cross-scope patches:

- one registration line / import in `src/blocks/registry.ts` or `src/inline/registry.ts`
- one render `case` (and any tiny helper) in `src/render.ts`
- type additions in `src/types.ts` / `src/contracts.ts` when the AST shape changes
- update this DESIGN.md section when those interfaces change

Mark intentional cross-scope commits with `cross-scope: <reason>` in the commit message.

## Quality bar

Each module is done only when it passes **all** CommonMark spec examples for its
`spec_sections`. The harness scores those sections after your edit and may send
failing IN/EXP/GOT examples back for fix rounds. Prefer correct edge cases over
a happy-path stub.

## Shared pipeline contract

- `renderMarkdown(input: string): string` remains the public entry (scorer / CLI).
- Empty / whitespace-only input returns `""`.
- Build must stay green (`npm run build` / `tsc`) after every merge.
