import * as React from 'react'
import { TextEditor } from '../../react/components/TextEditor/TextEditor'
import { Theme } from '../../react/components/Theme/Theme'
import { Code } from '../components/Code'

/** Variable groups read from `:root` (Layout’s unnamed `<Theme />`). */
const ROOT_THEME_CSS_SNAPSHOT_SECTIONS: readonly { readonly title: string, readonly vars: readonly string[] }[] = [
  {
    title: 'Color variables',
    vars: [
      '--basis-color-primary',
      '--basis-color-contrast',
      '--basis-color-danger',
      '--basis-color-danger-contrast',
      '--basis-color-success',
      '--basis-color-success-contrast',
      '--basis-color-background',
      '--basis-color-foreground',
      '--basis-color-disabled',
      '--basis-color-disabled-text',
      '--basis-color-overlay-dark',
      '--basis-color-overlay-light',
    ],
  },
  {
    title: 'Typography variables',
    vars: [
      '--basis-font-size-xxs',
      '--basis-font-size-xs',
      '--basis-font-size-sm',
      '--basis-font-size-md',
      '--basis-font-size-lg',
      '--basis-font-size-xl',
      '--basis-font-size-xxl',
    ],
  },
  {
    title: 'Spacing variables',
    vars: [
      '--basis-unit-xxs',
      '--basis-unit-xs',
      '--basis-unit-sm',
      '--basis-unit-md',
      '--basis-unit-lg',
      '--basis-unit-xl',
      '--basis-unit-xxl',
    ],
  },
  {
    title: 'Border radius variables',
    vars: ['--basis-radius-sm', '--basis-radius-md', '--basis-radius-lg', '--basis-radius-round'],
  },
  {
    title: 'Shadow variables',
    vars: ['--basis-shadow-sm', '--basis-shadow-md', '--basis-shadow-lg'],
  },
  {
    title: 'Transition variables',
    vars: ['--basis-transition-fast', '--basis-transition-medium', '--basis-transition-slow'],
  },
]

interface State {
  borderRadius: number,
  fontSize: number,
  previewCode: string,
  primaryColor: string,
  rootThemeCss: string,
  shadow: string,
  themeName: string,
}

export class ThemeDocs extends React.Component<object, State> {
  previewThemeTargetRef = React.createRef<HTMLDivElement>()

  state: State = {
    borderRadius: 8,
    fontSize: 100,
    previewCode: '',
    primaryColor: '#0070f3',
    rootThemeCss: '',
    shadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
    themeName: 'custom',
  }

  static formatCssVariableSnapshot(
    target: Element | null,
    sections: readonly { readonly title: string, readonly vars: readonly string[] }[],
  ): string {
    if (target == null || typeof getComputedStyle === 'undefined') {
      return '/* Open this page in the browser to load live values from Theme. */'
    }
    const computed = getComputedStyle(target)
    const lines: string[] = []
    for (const { title, vars } of sections) {
      if (lines.length > 0) lines.push('')
      lines.push(`/* ${title} */`)
      for (const variable of vars) {
        lines.push(`  ${variable}: ${computed.getPropertyValue(variable).trim()};`)
      }
    }
    return lines.join('\n')
  }

  static formatPreviewVariableLines(target: Element | null): string {
    if (target == null || typeof getComputedStyle === 'undefined') {
      return '/* Open in browser for computed theme values on this preview. */'
    }
    const computed = getComputedStyle(target)
    const line = (name: string) => `  ${name}: ${computed.getPropertyValue(name).trim()};`
    return [
      '/* Preview element (scoped theme) */',
      line('--basis-color-primary'),
      line('--basis-color-contrast'),
      line('--basis-font-size-md'),
      line('--basis-radius-md'),
    ].join('\n')
  }

  #refreshSnapshots = (): void => {
    if (typeof document === 'undefined') return
    requestAnimationFrame(() => {
      this.setState({
        previewCode: ThemeDocs.formatPreviewVariableLines(this.previewThemeTargetRef.current),
        rootThemeCss: ThemeDocs.formatCssVariableSnapshot(document.documentElement, ROOT_THEME_CSS_SNAPSHOT_SECTIONS),
      })
    })
  }

  override componentDidMount(): void {
    this.#refreshSnapshots()
  }

  override componentDidUpdate(prevProps: Readonly<object>, prevState: Readonly<State>): void {
    if (
      prevState.borderRadius !== this.state.borderRadius
      || prevState.fontSize !== this.state.fontSize
      || prevState.primaryColor !== this.state.primaryColor
      || prevState.shadow !== this.state.shadow
      || prevState.themeName !== this.state.themeName
    ) {
      this.#refreshSnapshots()
    }
  }

  render(): React.ReactNode {
    return (
      <>
        <h1>Theme</h1>
        <section>
          <p>
            Theme is a powerful component that manages design tokens and CSS variables for your application.
            It provides a centralized way to define colors, typography, spacing, shadows, and other design
            values that can be used consistently across all components.
          </p>
        </section>
        <section>
          <h2>Key Features</h2>
          <ul>
            <li>
              <strong>Design Token System</strong>:
              Centralized management of colors, typography, spacing, and more
            </li>
            <li>
              <strong>CSS Variable Generation</strong>:
              Automatically creates CSS custom properties for all theme values
            </li>
            <li><strong>Smart Color Processing</strong>:
              Auto-computes contrast colors for primary colors using luminance analysis
            </li>
            <li><strong>Namespaced Themes</strong>: Support for multiple named themes with automatic CSS scoping</li>
            <li><strong>Smart Value Processing</strong>: Automatic unit conversion and color processing</li>
            <li><strong>Performance Optimized</strong>: Styles are injected once and reused efficiently</li>
            <li><strong>Type Safe</strong>: Full TypeScript support for all theme properties</li>
          </ul>
        </section>
        <section>
          <h2>Interactive Demo</h2>
          <div style={{ display: 'grid', gap: '2rem', gridTemplateColumns: '300px 1fr' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <h4>Theme Name</h4>
                <TextEditor
                  field="themeName"
                  initialValue={this.state.themeName}
                  placeholder="Enter theme name"
                  onChange={value => this.setState({ themeName: value })}
                />
              </div>
              <div>
                <h4>Primary Color</h4>
                <input
                  style={{ padding: '0.5rem', width: '100%' }}
                  type="color"
                  value={this.state.primaryColor}
                  onChange={e => this.setState({ primaryColor: e.target.value })}
                />
              </div>
              <div>
                <h4>Font Size (Base: 16px)</h4>
                <input
                  max="150"
                  min="75"
                  step="12.5"
                  style={{ padding: '0.5rem', width: '100%' }}
                  type="range"
                  value={this.state.fontSize}
                  onChange={e => this.setState({ fontSize: Number(e.target.value) })}
                />
                <span>{this.state.fontSize}% ({Math.round(16 * this.state.fontSize / 100)}px)</span>
              </div>
              <div>
                <h4>Border Radius</h4>
                <input
                  max="24"
                  min="0"
                  step="2"
                  style={{ padding: '0.5rem', width: '100%' }}
                  type="range"
                  value={this.state.borderRadius}
                  onChange={e => this.setState({ borderRadius: Number(e.target.value) })}
                />
                <span>{this.state.borderRadius}px</span>
              </div>
            </div>
            <div style={{ border: '1px solid #ccc', borderRadius: '4px', padding: '2rem' }}>
              <Theme
                color={{ primary: this.state.primaryColor }}
                fontSize={{ md: this.state.fontSize }}
                name={this.state.themeName}
                radius={{ md: this.state.borderRadius }}
                shadow={{ md: this.state.shadow }}
              />
              <div
                ref={this.previewThemeTargetRef}
                data-theme={this.state.themeName}
                style={{
                  backgroundColor: 'var(--basis-color-primary)',
                  borderRadius: 'var(--basis-radius-md)',
                  boxShadow: 'var(--basis-shadow-md)',
                  color: 'var(--basis-color-contrast)',
                  fontSize: `${this.state.fontSize}%`,
                  padding: '1rem',
                  textAlign: 'center',
                }}
              >
                <h3>Theme Preview</h3>
                <p>This element uses CSS variables from your custom theme!</p>
                <div style={{
                  backgroundColor: '#ffffff88',
                  borderRadius: '4px',
                  margin: '1rem 0',
                  padding: '0.5rem',
                  textAlign: 'left',
                  whiteSpace: 'pre-wrap',
                }}
                >
                  <code>{this.state.previewCode}</code>
                </div>
              </div>
            </div>
          </div>
        </section>
        <section>
          <h2>Usage Examples</h2>
          <h3>Basic Theme</h3>
          {Code.format(`
            <Theme name="light" />
          `)}
          <h3>Custom Colors</h3>
          {Code.format(`
            <Theme
              name="brand"
              color={{
                primary: '#ff6b35',
                background: '#f8f9fa',
                foreground: '#212529',
              }}
            />
          `)}
          <h3>Complete Theme</h3>
          {Code.format(`
            <Theme
              name="dark"
              color={{
                background: '#1a1a1a',
                foreground: '#ffffff',
                primary: '#00d4ff',
              }}
              fontSize={{
                sm: 87.5,    // 14px
                md: 100,     // 16px
                lg: 112.5,   // 18px
              }}
              radius={{
                sm: 4,       // 4px
                md: 8,       // 8px
                lg: 16,      // 16px
              }}
              unit={{
                xs: 4,       // 4px
                sm: 8,       // 8px
                md: 16,      // 16px
                lg: 24,      // 24px
              }}
            />
          `)}
        </section>
        <section>
          <h2>Key Props</h2>
          <p>
            Theme accepts a comprehensive set of design tokens that are automatically converted to CSS
            variables. All values are optional and will fall back to sensible defaults.
          </p>
          <h3><code>name</code></h3>
          <p>
            The theme name used for namespacing CSS variables. When provided, variables are scoped
            to <code>[data-theme="name"]</code> selectors. When omitted, variables are applied globally.
          </p>
          <h3><code>color</code></h3>
          <p>
            Color palette for your theme. All colors are automatically processed and converted to
            consistent formats. Supports hex, rgb, hsl, and named colors.
          </p>
          <p>
            <strong>Auto-Computed Contrast</strong>: When you set a primary color, Theme automatically
            computes an appropriate contrast color using luminance analysis. Light primary colors get
            dark contrast colors, and dark primary colors get light contrast colors. This ensures
            optimal readability and accessibility. The semantic <code>color.danger</code> and{' '}
            <code>color.success</code> values similarly receive <code>--basis-color-danger-contrast</code>{' '}
            and <code>--basis-color-success-contrast</code> for overlays (for example dialog and notification
            chrome).
          </p>
          <h3><code>fontSize</code></h3>
          <p>
            Typography scale defined as percentages relative to the base font size (16px). Values are
            automatically converted to percentage units in CSS.
          </p>
          <h3><code>radius</code></h3>
          <p>
            Border radius values in pixels. Automatically converted to CSS with <code>px</code> units.
          </p>
          <h3><code>shadow</code></h3>
          <p>
            Box shadow definitions. Passed through as-is since shadows are already in CSS format.
          </p>
          <h3><code>transition</code></h3>
          <p>
            Transition timing definitions. Passed through as-is since transitions are already in CSS format.
          </p>
          <h3><code>unit</code></h3>
          <p>
            Spacing scale in pixels. Automatically converted to CSS with <code>px</code> units.
          </p>
        </section>
        <section>
          <h2>CSS Variable Generation</h2>
          <p>
            Theme automatically generates CSS custom properties for all design tokens. Variables are
            namespaced under <code>--basis-</code> and follow a consistent naming pattern.
          </p>
          <p>
            The block below is filled from <code>getComputedStyle(document.documentElement)</code> on each
            paint, so it always matches the unnamed <code>&lt;Theme /&gt;</code> in <code>Layout</code>{' '}
            (defaults merged into <code>:root</code>).
          </p>
          {Code.format(this.state.rootThemeCss, 'scss')}
          <h3>Namespaced Themes</h3>
          <p>
            When <code>name</code> is set, Theme emits <code>:root [data-theme="…"]</code> with the same
            variable names. Put <code>data-theme</code> on a subtree to apply that token set.
          </p>
          {Code.format(`
            .my-component {
              background-color: var(--basis-color-background);
              color: var(--basis-color-foreground);
            }
          `, 'css')}
        </section>
        <section>
          <h2>Default Values</h2>
          <p>
            JavaScript defaults are defined once in <code>libraries/react/components/Theme/Theme.tsx</code> as{' '}
            <code>DEFAULT_THEME</code>. Use the live CSS block above for resolved values in this app.
          </p>
        </section>
        <section>
          <h2>Using Theme Variables in CSS</h2>
          <p>
            Once Theme is rendered, you can use the generated CSS variables anywhere in your stylesheets:
          </p>
          {Code.format(`
            .my-button {
              background-color: var(--basis-color-primary);
              color: var(--basis-color-contrast);
              border-radius: var(--basis-radius-md);
              padding: var(--basis-unit-sm) var(--basis-unit-md);
              font-size: var(--basis-font-size-md);
              box-shadow: var(--basis-shadow-sm);
              transition: all var(--basis-transition-medium);
            }
            
            .my-card {
              background-color: var(--basis-color-background);
              border: 1px solid var(--basis-color-disabled);
              border-radius: var(--basis-radius-lg);
              padding: var(--basis-unit-lg);
              box-shadow: var(--basis-shadow-md);
            }
          `)}
        </section>
        <section>
          <h2>Multiple Themes</h2>
          <p>
            You can create multiple themes and switch between them dynamically:
          </p>
          {Code.format(`
            // Light theme
            <Theme
              name="light"
              color={{
                background: '#ffffff',
                foreground: '#171717',
                primary: '#0070f3',
              }}
            />
            
            // Dark theme
            <Theme
              name="dark"
              color={{
                background: '#1a1a1a',
                foreground: '#ffffff',
                primary: '#00d4ff',
              }}
            />
            
            // Usage in components
            <div data-theme="light">Light themed content</div>
            <div data-theme="dark">Dark themed content</div>
          `)}
        </section>
        <section>
          <h2>Performance Considerations</h2>
          <p>
            Theme is optimized for performance:
          </p>
          <ul>
            <li><strong>Style Injection</strong>: Styles are injected once and reused efficiently</li>
            <li><strong>CSS Variables</strong>: No runtime JavaScript overhead for style calculations</li>
            <li><strong>Smart Updates</strong>: Only re-injects styles when theme props change</li>
            <li><strong>Namespacing</strong>: Multiple themes can coexist without conflicts</li>
          </ul>
          <p>
            The component renders as <code>null</code> and only manages CSS injection, making it
            extremely lightweight in the React component tree.
          </p>
        </section>
      </>
    )
  }
}
