import * as React from 'react'
import { Tag } from '@basis/react'
import { NumberEditor } from '../../react/components/NumberEditor/NumberEditor'
import { Link } from '../../react/components/Router/Link'
import { TextEditor } from '../../react/components/TextEditor/TextEditor'
import { Code } from '../components/Code'

interface State {
  autoFocus: boolean,
  placeholder: string,
  prefix: string,
  step: number,
  suffix: string,
  value: number,
}

export class NumberEditorDocs extends React.Component<object, State> {
  state: State = {
    autoFocus: false,
    placeholder: 'Enter a number...',
    prefix: '$',
    step: 1,
    suffix: 'USD',
    value: 1000,
  }

  render(): React.ReactNode {
    return (
      <>
        <h1>NumberEditor</h1>
        <section>
          <p>
            NumberEditor is a specialized number input component that extends the Editor base class to provide
            intelligent number handling with automatic formatting, parsing, and step-based navigation.
          </p>
        </section>
        <section>
          <h2>Key Features</h2>
          <ul>
            <li><strong>Automatic Formatting</strong>: Displays numbers with comma separators (e.g., "1,234,567")</li>
            <li><strong>Smart Parsing</strong>: Converts formatted strings back to numbers, handling commas</li>
            <li><strong>Step Navigation</strong>: Arrow key navigation with configurable step values</li>
            <li><strong>Zero Handling</strong>: Shows empty input instead of "0" for better UX</li>
            <li>
              <strong>Mixin Integration</strong>:
              Built-in support for accessibility, prefix/suffix, and placeholder features
            </li>
          </ul>
        </section>
        <section>
          <h2>Interactive Demo</h2>
          <div style={{ display: 'grid', gap: '2rem', gridTemplateColumns: '300px 1fr' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <strong>Placeholder</strong>
                <TextEditor
                  field="placeholder"
                  placeholder="Placeholder text"
                  value={this.state.placeholder}
                  onChange={value => this.setState({ placeholder: value })}
                />
              </div>
              <div>
                <strong>Prefix/Suffix</strong>
                <TextEditor
                  field="prefix"
                  placeholder="Prefix (e.g., $, €)"
                  value={this.state.prefix}
                  onChange={value => this.setState({ prefix: value })}
                />
                <TextEditor
                  field="suffix"
                  placeholder="Suffix (e.g., USD, items)"
                  value={this.state.suffix}
                  onChange={value => this.setState({ suffix: value })}
                />
              </div>
              <div>
                <strong>Step Navigation</strong>
                <select
                  style={{ padding: '0.5rem', width: '100%' }}
                  value={this.state.step}
                  onChange={e => this.setState({ step: Number(e.target.value) })}
                >
                  <option value="1">1 (default)</option>
                  <option value="5">5</option>
                  <option value="10">10</option>
                  <option value="0.1">0.1</option>
                </select>
              </div>
              <div>
                <strong>Value</strong>
                <NumberEditor
                  field="value"
                  placeholder="Enter value"
                  value={this.state.value}
                  onChange={value => this.setState({ value })}
                />
              </div>
            </div>
            {/* Demo Area */}
            <div style={{ border: '1px solid #ccc', borderRadius: '4px', padding: '1rem' }}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem' }}>
                  NumberEditor with all mixins:
                </label>
                <NumberEditor
                  autoFocus={this.state.autoFocus}
                  field="demo"
                  placeholder={this.state.placeholder}
                  prefix={this.state.prefix || undefined}
                  step={this.state.step}
                  suffix={this.state.suffix || undefined}
                  value={this.state.value}
                  onChange={value => this.setState({ value })}
                />
              </div>
            </div>
          </div>
        </section>
        <section>
          <h2>Usage Examples</h2>
          <h3>Basic Number Input</h3>
          {Code.format(`
            <NumberEditor
              field="quantity"
              placeholder="Enter quantity"
              onChange={(value, field) => setState(prev => ({ ...prev, [field]: value }))}
            />
          `)}
          <h3>With Step Navigation</h3>
          {Code.format(`
            <NumberEditor
              field="price"
              step={0.01}
              placeholder="Enter price"
              onChange={(value, field) => setState(prev => ({ ...prev, [field]: value }))}
            />
          `)}
        </section>
        <section>
          <h2>Key Props</h2>
          <p>
            NumberEditor supports both controlled and uncontrolled modes. Use <code>value</code> for controlled
            mode where you manage the state, or <code>initialValue</code> for uncontrolled mode where the
            component manages its own state.
          </p>
          <p>
            The <code>field</code> prop is used to identify the input in form management scenarios,
            while <code>step</code> enables arrow key navigation with configurable increments.
          </p>
          <h3>Mixin System</h3>
          <p>
            NumberEditor uses the Component class's mixin system for enhanced functionality. For detailed
            information about each mixin, see the <Link to="/mixins">Mixins documentation</Link>.
          </p>
          {Code.format(`
            export class NumberEditor extends Editor<number, HTMLInputElement, Props> {
              static get mixins(): Set<Mixin> {
                return super.mixins
                  .add(Accessible)
                  .add(Focusable)
                  .add(Placeholder)
                  .add(PrefixSuffix)
              }
            }
          `)}
          <p>
            These mixins automatically provide accessibility features, auto-focus support, placeholder text,
            and prefix/suffix content. All mixins are automatically applied once declared.
          </p>
        </section>
        <section>
          <h2>Number Formatting & Parsing</h2>
          <h3>Display Formatting</h3>
          <p>
            NumberEditor automatically formats numbers for display using comma separators:
          </p>
          <ul>
            <li><code>1234</code> → displays as <code>"1,234"</code></li>
            <li><code>1000000</code> → displays as <code>"1,000,000"</code></li>
            <li><code>0</code> → displays as empty string (for better UX)</li>
          </ul>
          <h3>Step Navigation</h3>
          <p>
            When a <code>step</code> value is provided, users can navigate numbers using arrow keys:
          </p>
          <ul>
            <li><strong><Tag>↑</Tag> Arrow Up</strong>: Increases value by step amount</li>
            <li><strong><Tag>↓</Tag> Arrow Down</strong>: Decreases value by step amount</li>
          </ul>
        </section>
        <section>
          <h2>When to Use NumberEditor</h2>
          <p>
            NumberEditor is ideal for quantity inputs, prices, percentages, measurements, and any scenario
            requiring numeric input with validation. Consider alternatives when you need complex formatting,
            scientific notation, or specialized input types.
          </p>
        </section>
      </>
    )
  }
}
