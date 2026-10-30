import { Router } from 'basis/react'
import { Code } from '../components/Code'
import { DocumentationPage } from '../components/DocumentationPage'

export class OverviewDocs extends DocumentationPage<Record<string, never>> {
  content() {
    return (
      <>
        <section>
          <h1>Basis React Components</h1>
          <p>Basis is a cohesive UI component library built entirely with class-based React components. The architecture is designed for composable classes with clear responsibilities, so you get predictable structure, excellent TypeScript ergonomics, and first-class accessibility.</p>
          <p>All components inherit from the <Router.Link to="/components/component">Component</Router.Link> base class, providing a consistent interface, shared functionality, and a strong lifecycle.</p>
        </section>
        <section>
          <h3>Design Principles and Conventions</h3>
          <ul>
            <li><strong>className</strong> communicates a component's type clearly. A <code>Button</code> component is <code>.button.component</code>.</li>
            <li><strong>data-*</strong> reflects runtime state. A <code>Link</code> component with <code>state.active</code> renders <code>data-active="true"</code>.</li>
          </ul>
        </section>
        <section>
          <h3>Your First Component</h3>
          <p>Use Basis components from any React app. Here's a minimal class-based example:</p>
          {Code.format(`
            import { Button, Component, Dialog } from 'basis/react'

            interface Props {
              name: string,
            }

            class Hello extends Component<Props> {
              static displayName = 'Hello'
              static defaultProps = {
                name: 'world',
              }

              content(props: Props) {
                return super.content(<p>Hello, {props.name}!</p>)
              }
            }
          `)}
          <p>
            Without any additional code, this renders as:
            {Code.format(`
              <div class="hello component">
                <p>Hello, world!</p>
              </div>
            `)}
          </p>
          <p>Application components follow the same rule: extend <code>Component</code> (or <code>Editor</code>) rather than writing function components or hooks. The <Router.Link to="/compliance">Component compliance</Router.Link> page explains the enforced invariant, the <code>basis compliance</code> command, and the deliberate escape hatches.</p>
        </section>
        <section>
          <h3>Styling & Theming</h3>
          <p>All components are lightly styled with modern CSS via the lightweight <Router.Link to="/utilities">style</Router.Link> utility. Why? So that when you pull in basis components, you don't have to install or manage any CSS-preprocessors like SCSS/LESS. We keep selectors tight, drive visuals from <code>data-*</code> state, and expose CSS variables at the base and component level for customization.</p>
          {Code.format(`
            import { css, style } from 'basis/react'

            style('your:component', css\`
              .your.component {
                color: red;
              }
            \`)
          `)}
        </section>
        <section>
          <h3>What's Next?</h3>
          <ul>
            <li>If you're looking to build components using this library's style, check out the <Router.Link to="/components/component">Component</Router.Link> base class. If your component will edit data, check out the <Router.Link to="/components/editor">Editor</Router.Link> base class for even more leverage.</li>
            <li>If you just want to leverage basis components as a component library, browse the component docs on the left to see accessibility and styling details in context.</li>
            <li>The <Router.Link to="/engineering-principles">Engineering Principles</Router.Link> page explains the philosophy behind the architecture and the reviewer policies.</li>
          </ul>
        </section>
      </>
    )
  }
}
