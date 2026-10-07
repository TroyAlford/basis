# `@basis/markdown-plugin`

The Basis-owned Markdown/MDX lint surface. It bundles the shared remark/unified configuration and the Basis-specific rules so consumers do not copy the parser, the off-the-shelf rules, or the serialization settings.

`@basis/markdown-plugin` is an internal workspace. Consumers import its public surface, `basis/markdown`.

## Engine

Markdown and MDX are parsed with [`remark`](https://github.com/remarkjs/remark) / [`unified`](https://github.com/unifiedjs/unified) and linted with [`remark-lint`](https://github.com/remarkjs/remark-lint) rules (all MIT). `remark-frontmatter` preserves YAML front-matter, `remark-gfm` adds GFM, and `remark-mdx` adds MDX.

`remark-mdx` rejects ordinary prose such as `<T>` in a `.md` file, so the runner parses `.md` and `.mdx` with different pipelines rather than one MDX pipeline for both.

## Rules

### `basis/no-paragraph-line-breaks`

Forbids breaking a paragraph across multiple source lines. A renderer treats a soft line break as a space and word-wraps the paragraph itself, so wrapping it in source only adds diff and re-wrap churn. The autofix joins the wrapped lines; hard breaks (`break` nodes) are preserved.

### `remark-lint/no-consecutive-blank-lines`

The off-the-shelf [`remark-lint-no-consecutive-blank-lines`](https://github.com/remarkjs/remark-lint/tree/main/packages/remark-lint-no-consecutive-blank-lines) rule forbids more than one blank line between blocks. `remark-stringify` resolves it by emitting exactly one blank line between blocks.

### `remark-lint/ordered-list-marker-value`

The off-the-shelf [`remark-lint-ordered-list-marker-value`](https://github.com/remarkjs/remark-lint/tree/main/packages/remark-lint-ordered-list-marker-value) rule is configured with `'ordered'`, so an ordered list is numbered sequentially (`1.`, `2.`, `3.`) instead of every item sharing `1.`. `remark-stringify` renumbers the list.

## Configuration

`createMarkdownConfig` returns the plugin list and the canonical `remark-stringify` settings. The settings match Basis's existing conventions — `-` bullets and thematic breaks, `*` emphasis and strong, backtick fences — so a format pass only rewrites what a rule or canonical block spacing requires.

```ts
import { createMarkdownConfig } from 'basis/markdown'

const config = createMarkdownConfig({
  settings: { bullet: '+' },
})
```

`markdownConfig` is the zero-argument configuration, and `BASE_PLUGINS` / `BASE_SETTINGS` are the policy pieces on their own, exported for tests and tooling.

## Formatting

`basis format` serializes each document through the configured settings and the rules' autofixes, then re-lints the result so only genuinely residual findings are reported. `basis lint` reports the same findings without writing.

## Tests

The rule and the parsing contract are covered under `libraries/markdown-plugin/*.test.ts`: soft-wrapped paragraphs, hard breaks, list-item paragraphs, `.md` prose that is not valid MDX, front-matter, and the fix-then-converge contract.
