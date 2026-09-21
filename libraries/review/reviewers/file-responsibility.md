---
id: file-responsibility
title: File responsibility
executionProfile: local-semantic
context:
  - changed-files
  - changed-lines
  - enclosing-scope
  - repository-search
detectors: []
outcomes:
  - category: split-unit
    disposition: finding
    destructive: false
  - category: move-unit
    disposition: finding
    destructive: false
  - category: clarify-boundary
    disposition: question
    destructive: false
  - category: cohesive-file
    disposition: no_finding
    destructive: false
  - category: abstain
    disposition: abstain
    destructive: false
threshold:
  minimumConfidence: 0.7
  severity: warning
---

# File responsibility

Organize code around understandable units of responsibility, not arbitrary line
counts.

A file should have an obvious reason to exist. A reusable class, interface, type,
substantial function, or other independently meaningful unit should generally
have an obvious home of its own rather than being buried among unrelated units.

Do not use "the file is too long" as the review rule. A long implementation of
one coherent unit may be easier to understand than several artificially split
files. Conversely, a short file containing several unrelated exported concepts
may already have poor boundaries.

Look for changes that:

- add another independently meaningful exported unit to a file that already
  represents a different unit;
- accumulate a grab-bag of helpers, types, interfaces, classes, or constants
  whose only relationship is that they were convenient to place together;
- bury a reusable concept inside the implementation file of a different concept;
- make ownership ambiguous: a reader cannot tell which file should be opened to
  understand or change a particular responsibility.

Prefer explicit filenames that reveal what they contain.

Do not introduce nested `index.ts` barrel files as an organizational shortcut.
Barrels are acceptable only at a repository or monorepo-module root where they
define that module's public surface. Below that boundary, explicit files and
imports are easier to discover and reason about.

Do not split tightly coupled implementation details solely to satisfy this rule.
If several declarations exist only to implement one coherent unit and have no
independent meaning, keeping them together can be clearer.

When the conceptual boundary is ambiguous, ask what independently changes,
reuses, or owns the candidate unit. The answer should determine the file
boundary.

## Canonical examples

Concrete examples of the code this reviewer should notice and the feedback it
should give. These examples are part of the reviewer instructions.

### A grab bag of unrelated helpers

```ts
// utils.ts
export const formatDate = (date: Date): string => { /* ... */ }
export const slugify = (value: string): string => { /* ... */ }
export const fetchJson = async (url: string): Promise<unknown> => { /* ... */ }
export const clamp = (value: number, min: number, max: number): number => { /* ... */ }
```

Expected: `finding / split-unit`

Expected review feedback:

> `utils.ts` holds unrelated date, string, HTTP, and numeric helpers whose only
> relationship is convenience. Split them into files named for what they
> contain.

### A reusable unit buried in an unrelated file

```ts
// report-renderer.ts
export class ReportRenderer { render(report: Report): string { /* ... */ } }

export interface Money {
  amount: number
  currency: string
}
```

`Money` is reusable and unrelated to rendering.

Expected: `finding / move-unit`

Expected review feedback:

> `Money` is a reusable concept defined inside the report renderer. Give it its
> own file so it can be found and reused without importing the renderer.

### One coherent unit in a long file

```ts
// csv-parser.ts
export class CsvParser {
  parse(input: string): Row[] { /* ... */ }

  private splitRows(input: string): string[] { /* ... */ }
  private parseRow(line: string): Row { /* ... */ }
}
```

A long file, but one coherent implementation and its private helpers.

Expected: `no_finding`

Expected review feedback: none.
