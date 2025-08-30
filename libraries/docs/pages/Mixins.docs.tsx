import * as React from 'react'
import { Code } from '../components/Code'

export class MixinsDocs extends React.Component {
  render(): React.ReactNode {
    return (
      <>
        <h1>Mixins</h1>
        <section>
          <p>
            The Component class includes a powerful mixin system that allows you to compose behavior
            without inheritance. Mixins can modify both content and root elements, providing
            flexible composition patterns.
          </p>
          <p>
            Mixins are automatically integrated once declared, providing default props, content processing,
            root modification, and lifecycle method integration.
          </p>
        </section>
        <section>
          <h2>How to Use Mixins</h2>
          <h3>Declaring Mixins</h3>
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
          <h3>Automatic Integration</h3>
          <p>
            Once declared, mixins are automatically integrated:
          </p>
          <ul>
            <li><strong>Default Props</strong>: Mixin default props are automatically merged</li>
            <li>
              <strong>Content Processing</strong>:
              Content mixins are applied in order (respecting the <code>post</code> flag)
            </li>
            <li><strong>Root Modification</strong>: Render mixins modify the final root element</li>
            <li><strong>Lifecycle Methods</strong>: Mixin lifecycle methods are automatically called</li>
          </ul>
          <h3>Mixin Ordering</h3>
          <p>
            Mixins with <code>post: true</code> are applied after regular mixins, ensuring proper layering:
          </p>
          {Code.format(`
            // Mixins are applied in this order:
            // 1. Regular mixins (prefix, suffix, etc.)
            // 2. Post mixins (directional, etc.)
            
            export class Tooltip extends Component<Props> {
              static get mixins(): Set<Mixin> {
                return super.mixins
                  .add(Accessible)      // Applied first
                  .add(PrefixSuffix)    // Applied first
                  .add(Directional)     // Applied last (post: true)
              }
            }
          `)}
        </section>
        <section>
          <h2>Content Mixins</h2>
          <p>
            Content mixins modify the component's children/content. They are applied in the order
            they're declared, with post mixins applied last.
          </p>
          <h3>Accessible Mixin</h3>
          <p>
            Provides ARIA attributes and accessibility features for components.
          </p>
          {Code.format(`
            export const Accessible: Mixin<IAccessible> = {
              content<T extends React.ReactElement>(
                element: T,
                component: { props: IAccessible },
              ): T {
                const { label, description } = component.props
                
                return React.cloneElement(element, {
                  ...element.props,
                  'aria-label': label,
                  'aria-describedby': description,
                } as React.HTMLAttributes<HTMLElement>) as T
              },
              
              defaultProps: {
                label: undefined,
                description: undefined,
              },
            }
          `)}
          <p>
            <strong>Usage</strong>:
            Automatically adds <code>aria-label</code> and <code>aria-describedby</code> attributes
            to form inputs and interactive elements.
          </p>
          <h3>PrefixSuffix Mixin</h3>
          <p>
            Adds content before and after the main element, useful for labels, icons, or additional context.
          </p>
          {Code.format(`
            export const PrefixSuffix: Mixin<IPrefixSuffix> = {
              content<T extends React.ReactElement>(
                element: T,
                component: { props: IPrefixSuffix },
              ): T {
                const { prefix, suffix } = component.props
                
                return (
                  <>
                    {prefix && <div className="prefix">{prefix}</div>}
                    {element}
                    {suffix && <div className="suffix">{suffix}</div>}
                  </>
                ) as T
              },
              
              defaultProps: {},
              post: true, // Applied after other mixins
            }
          `)}
          <p>
            <strong>Usage:</strong> Perfect for adding currency symbols, units, or labels around
            inputs. Example: <code>&lt;NumberEditor prefix="$" suffix="USD" /&gt;</code>
          </p>
          <h3>Placeholder Mixin</h3>
          <p>
            Provides placeholder text support for input elements.
          </p>
          {Code.format(`
            export const Placeholder: Mixin<IPlaceholder> = {
              content<T extends React.ReactElement>(
                element: T,
                component: { props: IPlaceholder },
              ): T {
                const { placeholder } = component.props
                
                return React.cloneElement(element, {
                  ...element.props,
                  placeholder,
                } as React.HTMLAttributes<HTMLElement>) as T
              },
              
              defaultProps: {
                placeholder: undefined,
              },
            }
          `)}
          <p>
            <strong>Usage:</strong> Automatically adds <code>placeholder</code> attribute to input elements.
          </p>
          <h3>Focusable Mixin</h3>
          <p>
            Provides auto-focus support and focus management for components.
          </p>
          {Code.format(`
            export const Focusable: Mixin<IFocusable> = {
              componentDidMount(component: { props: IFocusable, rootNode?: HTMLElement | null }): void {
                if (component.props.autoFocus && component.rootNode) {
                  component.rootNode.focus()
                }
              },
              
              defaultProps: {
                autoFocus: false,
              },
            }
          `)}
          <p>
            <strong>Usage:</strong> Automatically focuses components when <code>autoFocus={true}</code> is set.
            Useful for form inputs that should receive focus immediately.
          </p>
        </section>
        <section>
          <h2>Render Mixins</h2>
          <p>
            Render mixins modify the component's root element. They are applied after content mixins
            to ensure the final element has all necessary attributes and styles.
          </p>
          <h3>Directional Mixin</h3>
          <p>
            Provides directional positioning and offset support for components like tooltips, dropdowns, and popovers.
          </p>
          {Code.format(`
            export const Directional: Mixin<IDirectional> = {
              render<T extends React.ReactElement>(
                element: T,
                component: { props: IDirectional },
              ): T {
                const { direction, offset } = component.props
                
                return React.cloneElement(element, {
                  ...element.props,
                  'data-direction': direction,
                  'style': {
                    ...element.props.style,
                    '--directional-offset': getOffsetString(offset),
                  },
                } as React.HTMLAttributes<HTMLElement>) as T
              },
              
              defaultProps: {
                direction: Direction.S,
                offset: 0,
              },
            }
          `)}
          <p>
            <strong>Usage</strong>: Automatically adds <code>data-direction</code> attribute
            and <code>--directional-offset</code> CSS variable for positioning components.
            Example: <code>&lt;Tooltip direction="NE" offset={8} /&gt;</code>
          </p>
        </section>
        <section>
          <h2>Creating Custom Mixins</h2>
          <p>
            You can create custom mixins by implementing the <code>Mixin</code> interface:
          </p>
          {Code.format(`
            interface ICustomMixin {
              customProp?: string
            }

            export const CustomMixin: Mixin<ICustomMixin> = {
              // Modify content
              content<T extends React.ReactElement>(
                element: T,
                component: { props: ICustomMixin },
              ): T {
                const { customProp } = component.props
                
                if (!customProp) return element
                
                return (
                  <div className="custom-wrapper" data-custom={customProp}>
                    {element}
                  </div>
                ) as T
              },
              
              // Modify root element
              render<T extends React.ReactElement>(
                element: T,
                component: { props: ICustomMixin },
              ): T {
                const { customProp } = component.props
                
                return React.cloneElement(element, {
                  ...element.props,
                  'data-custom-mixin': customProp,
                } as React.HTMLAttributes<HTMLElement>) as T
              },
              
              // Provide default props
              defaultProps: {
                customProp: 'default',
              },
              
              // Optional: lifecycle methods
              componentDidMount(component: { props: ICustomMixin }): void {
                console.log('Custom mixin mounted with:', component.props.customProp)
              },
              
              // Optional: post flag for ordering
              post: false,
            }
          `)}
          <h3>Mixin Interface</h3>
          <p>
            The <code>Mixin</code> interface defines what methods a mixin can implement:
          </p>
          {Code.format(`
            export interface Mixin<Props = unknown> {
              // Content modification
              content?<T extends React.ReactElement>(
                element: T,
                component: { props: Props },
              ): T,
              
              // Root element modification
              render?<T extends React.ReactElement>(
                element: T,
                component: { props: Props },
              ): T,
              
              // Default props
              defaultProps: Partial<Props>,
              
              // Lifecycle methods
              componentDidMount?<E extends HTMLElement | SVGElement, S>(
                component: Component<Props, E, S>,
              ): void,
              
              componentDidUpdate?<E extends HTMLElement | SVGElement, S>(
                component: Component<Props, E, S>,
                prevProps: Props,
                prevState: unknown,
              ): void,
              
              componentWillUnmount?<E extends HTMLElement | SVGElement, S>(
                component: Component<Props, E, S>,
              ): void,
              
              // Ordering flag
              post?: boolean,
            }
          `)}
        </section>
        <section>
          <h2>Best Practices</h2>
          <h3>Mixin Composition</h3>
          <ul>
            <li><strong>Keep Mixins Focused</strong>: Each mixin should handle one specific concern</li>
            <li>
              <strong>Use Post Flag Wisely</strong>:
              Only set <code>post: true</code> when the mixin needs to run after others
            </li>
            <li><strong>Provide Default Props</strong>: Always provide sensible defaults for mixin props</li>
            <li><strong>Handle Missing Props</strong>: Gracefully handle cases where optional props aren't provided</li>
          </ul>
          <h3>Performance Considerations</h3>
          <ul>
            <li><strong>Minimize DOM Manipulation</strong>: Use <code>React.cloneElement</code> efficiently</li>
            <li><strong>Cache Computed Values</strong>: Avoid recalculating values in render methods</li>
            <li><strong>Limit Mixin Count</strong>: Too many mixins can impact performance and readability</li>
          </ul>
        </section>
        <section>
          <h2>Real-World Examples</h2>
          <h3>Tooltip Component</h3>
          <p>
            The Tooltip component demonstrates effective mixin usage:
          </p>
          {Code.format(`
            export class Tooltip extends Component<Props> {
              static get mixins(): Set<Mixin> {
                return super.mixins.add(Directional)
              }
              
              // No need to manually apply mixins!
              // Directional mixin automatically:
              // - Adds direction/offset default props
              // - Sets data-direction attribute
              // - Adds --directional-offset CSS variable
              
              content(): React.ReactNode {
                return (
                  <>
                    <div className="bubble">{this.props.children}</div>
                    <div className="arrow" />
                  </>
                )
              }
            }
          `)}
          <h3>NumberEditor Component</h3>
          <p>
            The NumberEditor shows how multiple mixins work together:
          </p>
          {Code.format(`
            export class NumberEditor extends Editor<number, HTMLInputElement, Props> {
              static get mixins(): Set<Mixin> {
                return super.mixins
                  .add(Accessible)      // ARIA support
                  .add(Focusable)       // Auto-focus
                  .add(Placeholder)     // Placeholder text
                  .add(PrefixSuffix)    // Currency symbols, units
              }
              
              // All mixins are automatically applied!
              // No manual mixin application needed
            }
          `)}
        </section>
      </>
    )
  }
}
