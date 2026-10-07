import { Code } from '../components/Code'
import { DocumentationPage } from '../components/DocumentationPage'

export class MarkdownLintingDocs extends DocumentationPage<Record<string, never>> {
  content() {
    return (
      <>
        <section>
          <h1>Markdown linting</h1>
          <p>Basis lints Markdown and MDX with the shared <code>remark</code> / <code>unified</code> stack and the <code>remark-lint</code> rules (all MIT). The policy is Basis-owned, so consumers enable it through the shared surface instead of installing the parser, the rules, and the serialization settings themselves.</p>
        </section>
        <section>
          <h2>Enabling it</h2>
          <p>The supported zero-config route is the Basis CLI, which runs the TypeScript/JSX, CSS, and Markdown policies together:</p>
          {Code.format('bunx basis lint', 'bash')}
          <p><code>basis lint</code> reports; <code>basis format</code> applies the canonical serialization and every autofix in one pass:</p>
          {Code.format('bunx basis format', 'bash')}
          <p>A consumer can also adopt the shared configuration from their own unified pipeline:</p>
          {Code.format("import { createMarkdownConfig } from 'basis/lint'", 'ts')}
        </section>
        <section>
          <h2>What it enforces</h2>
          <ul>
            <li><strong>One line per paragraph</strong> — a renderer word-wraps paragraphs, so a soft line break in source is only diff and re-wrap churn. The autofix joins the wrapped lines and preserves hard breaks.</li>
            <li><strong>Single blank lines</strong> — no more than one blank line between blocks.</li>
            <li><strong>Sequential ordered lists</strong> — ordered lists are numbered <code>1.</code>, <code>2.</code>, <code>3.</code>, never every item sharing <code>1.</code>.</li>
          </ul>
          <p>The formatter serializes with Basis conventions (<code>-</code> bullets and thematic breaks, <code>*</code> emphasis and strong, backtick fences) and preserves YAML front-matter and MDX.</p>
        </section>
        <section>
          <h2>Bun-first</h2>
          <p>The Markdown policy is Bun-first: the parser, the off-the-shelf rules, and every serialization setting the configuration references are declared by Basis, so consumers never enumerate the dependency or configuration graph.</p>
        </section>
      </>
    )
  }
}
