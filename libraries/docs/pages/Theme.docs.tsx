import * as React from 'react'
import { Color } from '@basis/utilities'
import { TextEditor } from '../../react/components/TextEditor/TextEditor'
import { Theme } from '../../react/components/Theme/Theme'
import { Code } from '../components/Code'

interface State {
  borderRadius: number,
  fontSize: number,
  primaryColor: string,
  shadow: string,
  themeName: string,
}

export class ThemeDocs extends React.Component<object, State> {
  state: State = {
    borderRadius: 8,
    fontSize: 100,
    primaryColor: '#0070f3',
    shadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
    themeName: 'custom',
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
            {/* Demo Area */}
            <div style={{ border: '1px solid #ccc', borderRadius: '4px', padding: '2rem' }}>
              <Theme
                color={{ primary: this.state.primaryColor }}
                fontSize={{ md: this.state.fontSize }}
                name={this.state.themeName}
                radius={{ md: this.state.borderRadius }}
                shadow={{ md: this.state.shadow }}
              />
              <div
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
                }}
                >
                  <code>--basis-color-primary: {this.state.primaryColor}</code><br />
                  <code>--basis-color-contrast: {`${Color.fromHex(this.state.primaryColor).contrast()}`}</code><br />
                  <code>--basis-font-size-md: {this.state.fontSize}%</code><br />
                  <code>--basis-radius-md: {this.state.borderRadius}px</code>
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
            optimal readability and accessibility.
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
            namespaced under <code>--basis-</code> and follow a consistent naming pattern:
          </p>
          {Code.format(`
            /* Color variables */
            --basis-color-primary: #0070f3;
            --basis-color-contrast: #dddddded; /* Auto-computed contrast */
            --basis-color-background: #ffffff;
            --basis-color-foreground: #171717;
            
            /* Typography variables */
            --basis-font-size-sm: 87.5%;
            --basis-font-size-md: 100%;
            --basis-font-size-lg: 112.5%;
            
            /* Spacing variables */
            --basis-unit-xs: 4px;
            --basis-unit-sm: 8px;
            --basis-unit-md: 16px;
            --basis-unit-lg: 24px;
            
            /* Border radius variables */
            --basis-radius-sm: 4px;
            --basis-radius-md: 8px;
            --basis-radius-lg: 16px;
          `)}
          <h3>Namespaced Themes</h3>
          <p>
            When you provide a theme name, variables are scoped to that theme:
          </p>
          {Code.format(`
            /* With name="dark" */
            [data-theme="dark"] {
              --basis-color-primary: #00d4ff;
              --basis-color-contrast: #dddddded; /* Auto-computed contrast */
              --basis-color-background: #1a1a1a;
              --basis-color-foreground: #ffffff;
            }
            
            /* Usage in CSS */
            .my-component {
              background-color: var(--basis-color-background);
              color: var(--basis-color-foreground);
            }
          `)}
        </section>
        <section>
          <h2>Default Values</h2>
          <p>
            Theme provides sensible defaults for all design tokens. You only need to override the
            values you want to customize:
          </p>
          {Code.format(`
            const DEFAULT_THEME = {
              color: {
                background: '#ffffff',
                foreground: '#171717',
                primary: '#0070f3',
                disabled: '#e5e5e5',
                disabledText: '#a3a3a3',
                overlayDark: '#00000080',
                overlayLight: '#ffffff80',
              },
              fontSize: {
                xxs: 62.5,   // 10px
                xs: 75,      // 12px
                sm: 87.5,    // 14px
                md: 100,     // 16px
                lg: 112.5,   // 18px
                xl: 125,     // 20px
                xxl: 150,    // 24px
              },
              radius: {
                sm: 4,       // 4px
                md: 8,       // 8px
                lg: 16,      // 16px
                round: 50,   // 50px
              },
              unit: {
                xxs: 2,      // 2px
                xs: 4,       // 4px
                sm: 8,       // 8px
                md: 16,      // 16px
                lg: 24,      // 24px
                xl: 32,      // 32px
                xxl: 48,     // 48px
              },
              // ... and more defaults
            }
          `)}
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
