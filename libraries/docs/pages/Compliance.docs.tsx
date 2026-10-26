import { Link } from '../../react/components/Router/Link'
import { Code } from '../components/Code'
import { DocumentationPage } from '../components/DocumentationPage'

export class ComplianceDocs extends DocumentationPage<Record<string, never>> {
  content() {
    return (
      <>
        <section>
          <h1>Component compliance</h1>
          <p>Basis UI is class-based. Every application component extends the Basis <Link to="/components/Component">Component</Link> or <Link to="/components/Editor">Editor</Link> hierarchy, directly or indirectly. React function components, <code>React.FC</code> / <code>React.FunctionComponent</code>, <code>memo</code> and <code>forwardRef</code> function components, and React hooks are outside the contract.</p>
          <p>The Basis root <code>Component</code> is the single deliberate boundary onto <code>React.Component</code>. Application code does not extend React's base class directly.</p>
        </section>
        <section>
          <h2>One policy, two entry points</h2>
          <p><code>basis/eslint</code> enables <code>@basis/component-architecture</code>, so <code>basis lint</code> and <code>basis check</code> enforce the invariant with the rest of the Basis policy.</p>
          <p><code>basis compliance</code> runs the same rule implementation in a focused, report-only configuration for a non-formatting architectural gate:</p>
          {Code.format('bunx basis compliance', 'bash')}
          <p>The rule has no autofix. Converting a function component into a class is a design change, so diagnostics name the prohibited pattern and the supported replacement instead of rewriting source.</p>
        </section>
        <section>
          <h2>What it detects</h2>
          <ul>
            <li><strong>React hooks</strong>, including named and aliased imports, namespace-qualified calls such as <code>React.useState()</code>, and custom <code>use*</code> hook calls.</li>
            <li><strong>Function component types</strong>: <code>React.FC</code>, <code>FunctionComponent</code>, and their aliased imports.</li>
            <li><strong>Function component wrappers</strong>: <code>memo(function ...)</code> and <code>forwardRef</code> around a function.</li>
            <li><strong>Functions used as JSX component types</strong>, including local declarations, arrows, and exported PascalCase components that render JSX.</li>
            <li><strong>Classes extending React's base</strong>: <code>React.Component</code>, <code>React.PureComponent</code>, and the named equivalents imported from <code>react</code>.</li>
          </ul>
          <p>Recognition follows syntax, imports, scope bindings, and JSX references. A pure helper that merely returns React content is not a component, so ordinary domain functions and helpers remain valid.</p>
        </section>
        <section>
          <h2>Scope</h2>
          <p>Application component source is in scope. Test, screenshot, end-to-end, fixture, generated, and dependency files are out of scope by default, because React testing mechanics legitimately use function components and hooks. The same scope applies to <code>basis lint</code>, <code>basis check</code>, and <code>basis compliance</code>.</p>
        </section>
        <section>
          <h2>Migration and escape hatches</h2>
          <p>Prefer converting the function component to a class. A repository can temporarily exempt a path in its own Basis config:</p>
          {Code.format(`
            import { createConfig } from 'basis/eslint'

            export default createConfig({
              overrides: [
                {
                  files: ['src/legacy/**'],
                  rules: { '@basis/component-architecture': 'off' },
                },
              ],
            })
          `, 'js')}
          <p>For a single deliberate boundary, use an inline disable with a reason:</p>
          {Code.format(`
            // eslint-disable-next-line @basis/component-architecture -- Deliberate React boundary for this bridge.
            export class Bridge extends React.Component {}
          `, 'tsx')}
          <p><code>basis compliance</code> always applies the Basis-owned configuration, so a repository config that disables the rule does not weaken that command. Inline disables still work because they name the same rule. Use either escape hatch deliberately and remove it when the migration completes.</p>
        </section>
      </>
    )
  }
}
