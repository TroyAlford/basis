import { Code } from '../components/Code'
import { DocumentationPage } from '../components/DocumentationPage'

export class CssLintingDocs extends DocumentationPage<Record<string, never>> {
  content() {
    return (
      <>
        <section>
          <h1>CSS linting</h1>
          <p>Component CSS lives in <code>*.styles.ts</code> as <code>css</code> tagged template literals registered through <code>style(...)</code>. Basis lints that CSS with Stylelint, so the embedded stylesheet is parsed as real CSS rather than inspected as a string.</p>
          <p>The policy is Basis-owned. Consumers enable it through the shared surface instead of installing Stylelint, the custom syntax, and the Basis rules themselves.</p>
        </section>
        <section>
          <h2>Enabling it</h2>
          <p>The supported zero-config route is the Basis CLI, which runs the TypeScript/JSX, CSS, and Markdown policies together:</p>
          {Code.format('bunx basis lint', 'bash')}
          <p><code>basis lint</code> reports; <code>basis format</code> applies every autofix in one pass:</p>
          {Code.format('bunx basis format', 'bash')}
          <p>To run Stylelint directly, point it at the Basis config and the template-literal files. Add <code>--allow-empty-input</code> when a project may have no <code>*.styles.ts</code> files:</p>
          {Code.format(
            'bunx stylelint "**/*.styles.ts" --config ./node_modules/basis/stylelint.config.mjs',
            'bash',
          )}
          <p>A consumer can also adopt the shared config from their own Stylelint configuration:</p>
          {Code.format("export { default } from 'basis/stylelint'", 'js')}
          <p><code>basis/stylelint</code> exports the ready configuration as its default export, and a <code>createConfig</code> factory for appending repository-specific rule settings or overrides.</p>
        </section>
        <section>
          <h2>What it parses</h2>
          <p>Styles are read through <code>postcss-styled-syntax</code>, a maintained template-literal custom syntax. It understands the <code>css</code> tagged templates in TypeScript, nested CSS, and template interpolations inside selectors and values. This is why the policy can reason about declarations and selectors instead of matching text.</p>
        </section>
        <section>
          <h2>What it enforces</h2>
          <ul>
            <li><strong>Correctness</strong> — CSS parses successfully; unknown properties, malformed selectors, and accidental duplicate declarations or selectors are rejected.</li>
            <li><strong>Canonical casing</strong> — element/type selectors use lowercase spelling.</li>
            <li><strong>Deterministic ordering</strong> — custom properties, then ordinary declarations in alphabetical order, then nested selector blocks.</li>
            <li><strong>Nesting guardrails</strong> — stylesheets are normalized to their canonical ownership tree: redundant unary branches are flattened, repeated owners are factored, identical siblings are coalesced, and the component root is preserved. The rule autofixes wherever the transform is selector-equivalent.</li>
            <li><strong>Basis semantics</strong> — component state and variants are expressed with genuinely CSS-native state, neutral <code>data-*</code>, or a native element semantic when it applies — never an ad-hoc state class, and never an ARIA hook the rule invents.</li>
          </ul>
          <p>Ordering and style rules are safely autofixable. Run <code>basis format</code>, or Stylelint directly with <code>--fix</code>, to apply the deterministic order.</p>
        </section>
        <section>
          <h2>State selector semantics</h2>
          <p>Basis state is expressed with the platform's semantics. The Basis rule <code>basis/no-state-classes</code> rejects state classes such as <code>.disabled</code>, <code>.active</code>, <code>.selected</code>, and <code>.open</code>. The same applies to the other state names the policy encodes (for example <code>.checked</code>, <code>.expanded</code>, <code>.pressed</code>, <code>.read-only</code>, <code>.visible</code>, and <code>.loading</code>).</p>
          <p>The deterministic rule owns one claim — this class name is transient state and should not be a class. It cannot know an element's real accessibility semantics from CSS, so it never prescribes an ARIA attribute or role. It recommends:</p>
          <ul>
            <li>genuinely CSS-native state where it applies: <code>:hover</code>, <code>:focus</code>, <code>:focus-visible</code>, and <code>[hidden]</code>;</li>
            <li>a neutral <code>[data-*]</code> attribute for application state, for example <code>[data-active]</code>, <code>[data-selected]</code>, <code>[data-open]</code>, <code>[data-loading]</code>, and <code>[data-visible]</code>;</li>
            <li>for states where a native element semantic may apply — <code>disabled</code>, <code>checked</code>, <code>invalid</code>, and <code>read-only</code> — the native semantic when the element supports it, otherwise <code>[data-*]</code> (for example <code>:disabled</code>/<code>[disabled]</code> when supported, otherwise <code>[data-disabled]</code>).</li>
          </ul>
          <p>Choosing an existing genuine native/ARIA semantic as the better selector belongs to the <code>component-style-semantics</code> reviewer, because it depends on the element. ARIA attributes and roles must never be added merely to give CSS a selector. Use <code>[data-*]</code> for application state that has no real semantic already present.</p>
          <p>Structural, component, and mixin classes remain valid: <code>.button.component</code>, <code>.table.editor.component</code>, <code>.value</code>, <code>.prefix</code>, <code>.suffix</code>, and the like. The rule only rejects the explicit state-class vocabulary.</p>
        </section>
        <section>
          <h2>Bun-first</h2>
          <p>The CSS policy is Bun-first: Stylelint, the custom syntax, and every plugin the config references are declared by Basis, so consumers never enumerate the dependency or configuration graph.</p>
        </section>
      </>
    )
  }
}
