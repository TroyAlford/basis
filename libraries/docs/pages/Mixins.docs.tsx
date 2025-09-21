import * as React from 'react'
import { NumberEditor, Section } from '@basis/react'
import { Code } from '../components/Code'
import { Documentation } from '../components/Documentation'

export class MixinsDocs extends Documentation<Record<string, never>> {
  state = {
    current: {},
  }

  content(): React.ReactNode {
    return (
      <>
        <h1>Mixins</h1>
        <Section title="Overview">
          <p>
            The Component class includes a powerful mixin system that allows you to compose behavior
            without inheritance. Mixins can modify both content and root elements, providing
            flexible composition patterns.
          </p>
          <p>
            Mixins are automatically integrated once declared, providing default props, content processing,
            root modification, and lifecycle method integration.
          </p>
        </Section>
        <Section title="How to Use Mixins">
          <h2>Declaring Mixins</h2>
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
          <h2>Automatic Integration</h2>
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
          <h2>Mixin Ordering</h2>
          <p>
            Mixins with <code>post: true</code> are applied after regular mixins, ensuring proper layering:
          </p>
          {Code.format(`
            // Mixins are applied in this order:
            // 1. Regular mixins (prefix, suffix, etc.)
            // 2. Post mixins (popup, etc.)
            
            export class Tooltip extends Component<Props> {
              static get mixins(): Set<Mixin> {
                return super.mixins
                  .add(Accessible)      // Applied first
                  .add(PrefixSuffix)    // Applied first
                  .add(Popup)           // Applied last (post: true)
              }
            }
          `)}
        </Section>
        <Section title="Content Mixins">
          <p>
            Content mixins modify the component's children/content. They are applied in the order
            they're declared, with post mixins applied last.
          </p>
          <h2>Accessible Mixin</h2>
          <p>
            Provides ARIA attributes and accessibility features for components. Automatically
            adds <code>aria-label</code> and <code>aria-describedby</code> attributes to form inputs
            and interactive elements.
          </p>
          <p>
            <strong>Usage:</strong> Perfect for form inputs, buttons, and interactive elements
            that need proper accessibility labeling.
          </p>
          <h2>PrefixSuffix Mixin</h2>
          <p>
            Adds content before and after the main element, useful for labels, icons, or additional context.
            Wraps the component with prefix and suffix elements when provided.
          </p>
          <p>
            <strong>Usage:</strong> Perfect for adding currency symbols, units, or labels around inputs.
          </p>
          <p>
            <strong>Example:</strong>
            <NumberEditor prefix="$" suffix="USD" value={1000} />
            {Code.format(`
              <NumberEditor prefix="$" suffix="USD" value={1000} />
            `)}
          </p>
          <h2>Placeholder Mixin</h2>
          <p>
            Provides placeholder text support for input elements. Automatically adds
            the <code>placeholder</code> attribute to input elements.
          </p>
          <p>
            <strong>Usage:</strong> Essential for form inputs that need placeholder text for better UX.
          </p>
          <h2>Focusable Mixin</h2>
          <p>
            Provides auto-focus support and focus management for components. Automatically focuses
            components when <code>autoFocus={true}</code> is set.
          </p>
          <p>
            <strong>Usage:</strong> Useful for form inputs that should receive focus immediately
            when mounted or when certain conditions are met.
          </p>
          <h2>Pinnable Mixin</h2>
          <p>
            Provides column pinning functionality for table cells. Automatically applies CSS positioning
            to pin columns to the left or right side of a table, with automatic cleanup when unpinned.
          </p>
          <p>
            <strong>Usage:</strong> Used by Table HeaderCell and Cell components to implement sticky
            column functionality. Automatically handles CSS positioning and cleanup.
          </p>
          <p>
            <strong>Features:</strong>
          </p>
          <ul>
            <li><strong>Left Pinning</strong>: Pins element to the left side using <code>position: sticky</code></li>
            <li><strong>Right Pinning</strong>: Pins element to the right side using <code>position: sticky</code></li>
            <li><strong>Automatic Cleanup</strong>: Removes positioning styles when unpinned</li>
            <li><strong>Data Attributes</strong>: Adds <code>data-pin</code> attribute for CSS targeting</li>
          </ul>
        </Section>
        <Section title="Render Mixins">
          <p>
            Render mixins modify the component's root element. They are applied after content mixins
            to ensure the final element has all necessary attributes and styles.
          </p>
          <h2>Popup Mixin</h2>
          <p>
            Provides flexible positioning support using Floating UI primitives for components like tooltips,
            dropdowns, and popovers. Supports both anchor-based and parent-based positioning with automatic
            repositioning on updates.
          </p>
          <p>
            <strong>Usage:</strong> Automatically handles positioning using Floating UI with support for
            all anchor points, automatic repositioning, and arrow positioning.
          </p>
          <p>
            <strong>Example:</strong>
            {Code.format(`
              <Tooltip anchorTo={ref} anchorPoint={AnchorPoint.BottomEnd} arrow={true} />
            `)}
          </p>
          <h5>Available Anchor Points</h5>
          <p>
            The Popup mixin supports 12 anchor point options that directly map to Floating UI placement values:
          </p>
          <ul>
            <li><strong>Top</strong>: Above the reference element with center alignment</li>
            <li><strong>Top Start</strong>: Above the reference element with left alignment</li>
            <li><strong>Top End</strong>: Above the reference element with right alignment</li>
            <li><strong>Bottom</strong>: Below the reference element with center alignment</li>
            <li><strong>Bottom Start</strong>: Below the reference element with left alignment</li>
            <li><strong>Bottom End</strong>: Below the reference element with right alignment</li>
            <li><strong>Left</strong>: To the left of the reference element with center alignment</li>
            <li><strong>Left Start</strong>: To the left of the reference element with top alignment</li>
            <li><strong>Left End</strong>: To the left of the reference element with bottom alignment</li>
            <li><strong>Right</strong>: To the right of the reference element with center alignment</li>
            <li><strong>Right Start</strong>: To the right of the reference element with top alignment</li>
            <li><strong>Right End</strong>: To the right of the reference element with bottom alignment</li>
          </ul>
          <h5>Anchor vs Parent Positioning</h5>
          <p>
            Components using the Popup mixin can position themselves relative to either a specific anchor element
            (via the <code>anchorTo</code> prop) or automatically to their parent element. When an anchor ref
            is provided, the popup positions relative to that element. When omitted, it falls back to parent-based
            positioning.
          </p>
        </Section>
        <Section title="Creating Custom Mixins">
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
          <h2>Mixin Interface</h2>
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
        </Section>
        <Section title="Best Practices">
          <h2>Mixin Composition</h2>
          <ul>
            <li><strong>Keep Mixins Focused</strong>: Each mixin should handle one specific concern</li>
            <li>
              <strong>Use Post Flag Wisely</strong>:
              Only set <code>post: true</code> when the mixin needs to run after others
            </li>
            <li><strong>Provide Default Props</strong>: Always provide sensible defaults for mixin props</li>
            <li><strong>Handle Missing Props</strong>: Gracefully handle cases where optional props aren't provided</li>
          </ul>
          <h2>Performance Considerations</h2>
          <ul>
            <li><strong>Minimize DOM Manipulation</strong>: Use <code>React.cloneElement</code> efficiently</li>
            <li><strong>Cache Computed Values</strong>: Avoid recalculating values in render methods</li>
            <li><strong>Limit Mixin Count</strong>: Too many mixins can impact performance and readability</li>
          </ul>
        </Section>
        <Section title="Real-World Examples">
          <h2>Tooltip Component</h2>
          <p>
            The Tooltip component demonstrates effective mixin usage:
          </p>
          {Code.format(`
            export class Tooltip extends Component<Props> {
              static get mixins(): Set<Mixin> {
                return super.mixins.add(Popup)
              }
              
              // No need to manually apply mixins!
              // Popup mixin automatically:
              // - Adds anchorPoint/offset/arrow default props
              // - Sets data-popup attributes
              // - Handles positioning with Floating UI
              // - Manages repositioning on updates
              
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
          <h2>NumberEditor Component</h2>
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
          <h2>Table Cell Components</h2>
          <p>
            The Table HeaderCell and Cell components demonstrate the Pinnable mixin:
          </p>
          {Code.format(`
            export class HeaderCell<TRow, TField> extends Editor<ColumnProps<TRow, TField>> {
              static get mixins(): Set<Mixin> {
                return super.mixins.add(Pinnable)
              }
              
              // Pinnable mixin automatically:
              // - Adds data-pin attribute
              // - Handles CSS positioning for sticky columns
              // - Cleans up styles when unpinned
              // - Runs on mount and update
            }
          `)}
        </Section>
      </>
    )
  }
}
