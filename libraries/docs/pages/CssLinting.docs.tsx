import { Code } from '../components/Code'
import { Documentation } from '../components/Documentation'

export class CssLintingDocs extends Documentation<Record<string, never>> {
  content() {
    return (
      <>
        <section>
          <h1>CSS linting</h1>
          <p>
            Component CSS lives in <code>*.styles.ts</code> as <code>css</code> tagged template
            literals registered through <code>style(...)</code>. Basis lints that CSS with
            Stylelint, so the embedded stylesheet is parsed as real CSS rather than inspected as a
            string.
          </p>
          <p>
            The policy is Basis-owned. Consumers enable it through the shared surface instead of
            installing Stylelint, the custom syntax, and the Basis rules themselves.
          </p>
        </section>
        <section>
          <h2>Enabling it</h2>
          <p>
            The supported zero-config route is the Basis CLI, which runs the TypeScript/JSX and CSS
            policies together:
          </p>
          {Code.format('bunx basis lint', 'bash')}
          <p>
            To run Stylelint directly, point it at the Basis config and the template-literal files.
            Add <code>--allow-empty-input</code> when a project may have no{' '}
            <code>*.styles.ts</code> files:
          </p>
          {Code.format(
            'bunx stylelint "**/*.styles.ts" --config ./node_modules/basis/stylelint.config.mjs',
            'bash',
          )}
          <p>
            A consumer can also adopt the shared config from their own Stylelint configuration:
          </p>
          {Code.format("export { default } from 'basis/stylelint'", 'js')}
          <p>
            <code>basis/stylelint</code> exports the ready configuration as its default export, and
            a <code>createConfig</code> factory for appending repository-specific rule settings or
            overrides.
          </p>
        </section>
        <section>
          <h2>What it parses</h2>
          <p>
            Styles are read through <code>postcss-styled-syntax</code>, a maintained
            template-literal custom syntax. It understands the <code>css</code> tagged templates in
            TypeScript, nested CSS, and template interpolations inside selectors and values. This is
            why the policy can reason about declarations and selectors instead of matching text.
          </p>
        </section>
        <section>
          <h2>What it enforces</h2>
          <ul>
            <li>
              <strong>Correctness</strong> — CSS parses successfully; unknown properties, malformed
              selectors, and accidental duplicate declarations or selectors are rejected.
            </li>
            <li>
              <strong>Canonical casing</strong> — element/type selectors use lowercase spelling.
            </li>
            <li>
              <strong>Deterministic ordering</strong> — custom properties, then ordinary
              declarations in alphabetical order, then nested selector blocks.
            </li>
            <li>
              <strong>Nesting guardrails</strong> — descendants, states, and pseudo-selectors stay
              nested inside their owning selector rather than repeating top-level selector chains.
            </li>
            <li>
              <strong>Basis semantics</strong> — component state and variants are expressed with
              native pseudo-classes/attributes, ARIA attributes, or <code>data-*</code> attributes,
              not ad-hoc state classes.
            </li>
          </ul>
          <p>
            Ordering and style rules are safely autofixable. Run Stylelint with <code>--fix</code>{' '}
            (or let the Basis lint workflow report them) to apply the deterministic order.
          </p>
        </section>
        <section>
          <h2>State selector semantics</h2>
          <p>
            Basis state is expressed with the platform's semantics. The Basis rule{' '}
            <code>basis/no-state-classes</code> rejects state classes such as <code>.disabled</code>,{' '}
            <code>.active</code>, <code>.selected</code>, and <code>.open</code>. The same applies
            to the other state names the policy encodes (for example <code>.checked</code>,{' '}
            <code>.expanded</code>, <code>.pressed</code>, <code>.read-only</code>,{' '}
            <code>.visible</code>, and <code>.loading</code>).
          </p>
          <ul>
            <li>
              Prefer the native semantic where one exists: <code>:disabled</code>,{' '}
              <code>[disabled]</code>, <code>:checked</code>, <code>:hover</code>,{' '}
              <code>:focus-visible</code>, <code>:invalid</code>, <code>:hidden</code>, and{' '}
              <code>[readonly]</code>.
            </li>
            <li>
              Prefer ARIA attributes for accessibility state: <code>[aria-selected="true"]</code>,{' '}
              <code>[aria-expanded="true"]</code>, <code>[aria-pressed="true"]</code>,{' '}
              <code>[aria-busy="true"]</code>, and <code>[aria-disabled="true"]</code>.
            </li>
            <li>
              Use <code>[data-*]</code> for Basis/application state and variants a component
              exposes, for example <code>[data-open]</code>, <code>[data-loading]</code>,{' '}
              <code>[data-state="on"]</code>, and <code>[data-visible]</code>.
            </li>
          </ul>
          <p>
            ARIA selectors are appropriate only when the ARIA attribute represents the element's
            real accessibility semantics. Do not add ARIA merely as a CSS styling hook; use{' '}
            <code>[data-*]</code> for application state when no corresponding semantic ARIA or
            native state exists.
          </p>
          <p>
            Structural, component, and mixin classes remain valid: <code>.button.component</code>,{' '}
            <code>.table.editor.component</code>, <code>.value</code>, <code>.prefix</code>,{' '}
            <code>.suffix</code>, and the like. The rule only rejects the explicit state-class
            vocabulary.
          </p>
        </section>
        <section>
          <h2>Bun-first</h2>
          <p>
            The CSS policy is Bun-first: Stylelint, the custom syntax, and every plugin the config
            references are declared by Basis, so consumers never enumerate the dependency or
            configuration graph.
          </p>
        </section>
      </>
    )
  }
}
