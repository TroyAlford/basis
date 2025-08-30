import * as React from 'react'
import { Link } from '../../react/components/Router/Link'
import { Code } from '../components/Code'

export class ComponentDocs extends React.Component {
  render(): React.ReactNode {
    return (
      <>
        <h1>Component</h1>
        <section>
          <p>
            The Component class provides a foundation for building React components with consistent
            patterns and reduced boilerplate. It extends React's base Component class with additional
            functionality that addresses common development needs.
          </p>
          <p>
            While React's Component class is perfectly adequate for many use cases, this extension
            offers conveniences that can improve developer productivity and code consistency in larger
            applications.
          </p>
        </section>
        <section>
          <h2>Key Benefits</h2>
          <ul>
            <li>
              <strong>Reduced Boilerplate</strong>:
              Automatic class naming, ARIA/data attribute handling, and theme integration
            </li>
            <li>
              <strong>Attribute Surface Area</strong>:
              Consistent expandable surface for applying any <code>aria-*</code> or <code>data-*</code> props
            </li>
            <li>
              <strong>Theme Integration</strong>:
              Built-in theming system that works with the Theme component
            </li>
            <li>
              <strong>Better TypeScript</strong>:
              Improved generic support and type inference
            </li>
            <li><strong>Enhanced State Management:</strong> Promise-based setState with lifecycle handling</li>
          </ul>
        </section>
        <section>
          <h2>Boilerplate Reduction in Practice</h2>
          <p>
            The Component class eliminates repetitive code patterns. Here are real examples from the codebase:
          </p>
          <h3>Simple Component - Tag</h3>
          <p>
            The Tag component shows how minimal the boilerplate can be:
          </p>
          {Code.format(`
            export class Tag extends Component<Props, HTMLSpanElement> {
              static displayName = 'Tag'

              get attributes() {
                return {
                  ...super.attributes,
                  'data-removable': this.props.removable,
                }
              }

              content(): React.ReactNode {
                const { children, removable } = this.props
                return <>
                  <span className="content">{children}</span>
                  {removable && (
                    <a className="remove" onClick={this.#handleRemove}>×</a>
                  )}
                </>
              }
            }
          `)}
          <p>
            This component automatically gets:
          </p>
          <ul>
            <li>CSS classes: <code>tag component</code></li>
            <li>Theme support via <code>data-theme</code> attribute</li>
            <li>Any <code>aria-*</code> or <code>data-*</code> props passed in</li>
            <li>Proper TypeScript typing with HTMLSpanElement</li>
          </ul>
          <h3>Complex Component - TextEditor</h3>
          <p>
            Even complex components benefit from the reduced boilerplate:
          </p>
          {Code.format(`
            export class TextEditor extends Editor<string, HTMLInputElement | HTMLTextAreaElement, Props> {
              static displayName = 'TextEditor'

              get attributes() {
                return {
                  ...super.attributes,
                  'data-multiline': String(this.props.multiline),
                  'data-value': String(this.current || ''),
                }
              }

              content(): React.ReactNode {
                // Complex rendering logic here
                const input = this.props.multiline !== false ? (
                  <textarea ref={this.#input} /* ... */ />
                ) : (
                  <input ref={this.#input} /* ... */ />
                )
                
                return super.content(applyMixins(input, this, [Accessible, PrefixSuffix, Placeholder]))
              }
            }
          `)}
        </section>
        <section>
          <h2>Mixin System</h2>
          <p>
            The Component class includes a powerful mixin system that allows you to compose behavior
            without inheritance. Mixins can modify both content and root elements, providing flexible
            composition patterns.
          </p>
          <p>
            For comprehensive documentation on all available mixins and how to create custom ones,
            see the <Link to="/mixins">Mixins documentation</Link>.
          </p>
          <h3>Quick Start</h3>
          <p>
            Components declare their mixins using a static getter:
          </p>
          {Code.format(`
            export class MyComponent extends Component<Props> {
              static get mixins(): Set<Mixin> {
                return super.mixins
                  .add(Accessible)
                  .add(PrefixSuffix)
                  .add(Placeholder)
              }
            }
          `)}
          <p>
            Once declared, mixins are automatically integrated, providing default props, content processing,
            root modification, and lifecycle method integration.
          </p>
        </section>
        <section>
          <h2>Core Features</h2>
          <h3>Automatic Class Naming</h3>
          <p>
            Components automatically receive consistent CSS classes based on their name:
          </p>
          {Code.format(`
            // Component class automatically generates:
            // <div class="user-profile component">...</div>
            export class UserProfile extends Component<Props> {
              // No need to manually manage class names
            }

            // Custom classes can still be added via props
            <UserProfile className="highlighted" />
            // Results in: <div class="user-profile component highlighted">...</div>
          `)}
          <p>
            <strong>Note:</strong> Some build systems munge class names during compilation. As a best practice,
            set a <code>static displayName</code> which will be used with preference if it exists, instead
            of the <code>constructor.name</code>:
          </p>
          {Code.format(`
            export class UserProfile extends Component<Props> {
              static displayName = 'UserProfile'
              
              // Now the class name is guaranteed to be 'user-profile' regardless of build system
            }
          `)}
          <h3>Attribute Surface Area</h3>
          <p>
            Any ARIA or data attributes passed as props are automatically applied to the root element:
          </p>
          {Code.format(`
            // Usage - pass any aria-* or data-* props directly
            <CustomButton 
              aria-pressed="true"
              aria-expanded="false"
              data-state="active"
              data-variant="primary"
            />

            // The Component class automatically handles the prefixing and application
            // No need to manually manage these in your component
          `)}
          <h3>Theme Integration</h3>
          <p>
            The theme prop works seamlessly with the Theme component:
          </p>
          {Code.format(`
            // Set different themes for different sections
            <Theme name="dark" color={{ primary: "#1a1a1a" }} />
            <Theme name="light" color={{ primary: "#0070f3" }} />
            
            // Apply themes to components
            <Button theme="dark">Dark Button</Button>
            <Button theme="light">Light Button</Button>

            // All components automatically get data-theme="dark" or data-theme="light"
            // CSS can target: [data-theme="dark"] .button.component { ... }
            // CSS can target: [data-theme="light"] .button.component { ... }
          `)}
          <h3>Flexible Element Types</h3>
          <p>
            Components can specify their root element type for proper semantic HTML:
          </p>
          {Code.format(`
            // Button component with proper HTMLButtonElement typing
            export class Button extends Component<Props, HTMLButtonElement> {
              override get tag(): Tag { return 'button' }
            }

            // Image component with HTMLImageElement
            export class Image extends Component<Props, HTMLImageElement, State> {
              override get tag(): Tag { return 'img' }
            }
          `)}
        </section>
        <section>
          <h2>Implementation Patterns</h2>
          <h3>Component Structure</h3>
          <p>
            These patterns have proven effective for building maintainable components:
          </p>
          {Code.format(`
            export class WellStructuredComponent extends Component<Props, HTMLDivElement, State> {
              // 1. Override tag for semantic HTML
              override get tag(): Tag { return 'section' }

              // 2. Override attributes for custom HTML attributes
              override get attributes() {
                return {
                  ...super.attributes,
                  'data-component-type': 'well-structured',
                  role: 'region',
                }
              }

              // 3. Override content for the main rendering logic
              override content(): React.ReactNode {
                return (
                  <header className="component-header">
                    <h2>{this.props.title}</h2>
                  </header>
                  <main className="component-content">
                    {this.props.children}
                  </main>
                )
              }
            }
          `)}
          <h3>State Updates</h3>
          <p>
            The Promise-based setState can be useful for complex state management scenarios:
          </p>
          {Code.format(`
            export class ReliableComponent extends Component<Props, State> {
              state = { loading: false, data: null, error: null }

              async performAction = async () => {
                // setState returns a Promise
                await this.setState({ loading: true, error: null })
                
                try {
                  const result = await this.props.action()
                  await this.setState({ loading: false, data: result })
                  this.props.onSuccess?.(result)
                } catch (error) {
                  await this.setState({ loading: false, error })
                  this.props.onError?.(error)
                }
              }
            }
          `)}
        </section>
        <section>
          <h2>Migration from React.Component</h2>
          <p>
            Upgrading existing components is straightforward:
          </p>
          {Code.format(`
            // Before: React.Component
            class OldComponent extends React.Component<Props, State> {
              render() {
                return (
                  <div 
                    className="old-component"
                    aria-label={this.props.label}
                    data-state={this.state.status}
                  >
                    {this.props.children}
                  </div>
                )
              }
            }

            // After: Component (with improvements)
            class NewComponent extends Component<Props, HTMLDivElement, State> {
              // Automatic class naming
              // Automatic ARIA/data attribute handling
              // Better TypeScript support
              // Promise-based state management
              
              override content(): React.ReactNode {
                return this.props.children
              }
            }
          `)}
        </section>
        <section>
          <h2>When to Use Component</h2>
          <p>
            The Component class is well-suited for:
          </p>
          <ul>
            <li><strong>Custom UI Components:</strong> Buttons, inputs, modals, and other interactive elements</li>
            <li><strong>Layout Components:</strong> Containers, grids, and structural elements</li>
            <li><strong>Form Components:</strong> Editors, validators, and form controls</li>
            <li><strong>Data Display:</strong> Tables, lists, and data visualization components</li>
            <li><strong>Navigation:</strong> Menus, breadcrumbs, and navigation elements</li>
          </ul>
          <p>
            Consider using React.Component directly when:
          </p>
          <ul>
            <li>Building utility components that don't need the full feature set</li>
            <li>Creating components that must remain lightweight for performance reasons</li>
            <li>Building components that need to work outside the @basis/react ecosystem</li>
          </ul>
        </section>
      </>
    )
  }
}
