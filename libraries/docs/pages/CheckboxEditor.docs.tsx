import * as React from 'react'
import { CheckboxEditor, Section, TextEditor } from '@basis/react'
import { Code } from '../components/Code'
import { Documentation } from '../components/Documentation'

interface State {
  allowIndeterminate: boolean,
  checked: boolean,
  disabled: boolean,
  label: string,
}

export class CheckboxEditorDocs extends Documentation<State> {
  static override get defaultProps() {
    return {
      ...super.defaultProps,
      initialValue: {
        allowIndeterminate: false,
        checked: false,
        disabled: false,
        label: 'Checkbox Label',
      },
    }
  }

  content(): React.ReactNode {
    return (
      <>
        <h1>CheckboxEditor</h1>
        <Section title="Interactive Demo">
          <p>
            The CheckboxEditor component provides a flexible, accessible checkbox input that extends the Editor
            base class. It uses custom square icons for visual representation while maintaining full accessibility
            with a hidden native checkbox.
          </p>
          <div style={{ display: 'grid', gap: '2rem', gridTemplateColumns: '300px 1fr' }}>
            {/* Configuration Menu */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <strong>Label Text</strong>
                <TextEditor
                  field="label"
                  placeholder="Checkbox label"
                  value={this.current.label}
                  onChange={this.handleField}
                />
              </div>
              <CheckboxEditor
                field="allowIndeterminate"
                value={this.current.allowIndeterminate}
                onChange={this.handleField}
              >
                Allow Indeterminate State (3-state)
              </CheckboxEditor>
              <CheckboxEditor
                field="disabled"
                value={this.current.disabled}
                onChange={this.handleField}
              >
                {this.current.disabled ? 'Disabled' : 'Enabled'}
              </CheckboxEditor>
            </div>
            {/* Demo Area */}
            <div style={{
              border: '1px solid #ccc',
              borderRadius: '.25em',
              display: 'flex',
              justifyContent: 'center',
            }}
            >
              <CheckboxEditor
                allowIndeterminate={this.current.allowIndeterminate}
                disabled={this.current.disabled}
                field="checked"
                value={this.current.checked}
                onChange={this.handleField}
              >
                {this.current.label}
              </CheckboxEditor>
            </div>
          </div>
        </Section>
        <Section title="Basic Usage">
          <p>
            The simplest way to use CheckboxEditor is with a boolean value:
          </p>
          {Code.format(`
            import { CheckboxEditor } from '@basis/react'

            function MyComponent() {
              const [checked, setChecked] = React.useState(false)

              return (
                <CheckboxEditor
                  value={checked}
                  onChange={setChecked}
                >
                  Enable notifications
                </CheckboxEditor>
              )
            }
          `)}
        </Section>
        <Section title="Checkbox States">
          <p>
            The CheckboxEditor supports three different states, each with its own visual representation:
          </p>
          <ul>
            <li><strong>Checked (<code>true</code>)</strong> - Shows <code>Square.Check</code> icon</li>
            <li><strong>Unchecked (<code>false</code>)</strong> - Shows <code>Square.X</code> icon</li>
            <li><strong>Indeterminate (<code>null</code>)</strong> - Shows <code>Square.Dash</code> icon</li>
          </ul>
          <p>
            The native checkbox is hidden but remains functional for accessibility and form submission.
          </p>
        </Section>
        <Section title="Three-State Checkboxes">
          <p>
            Enable indeterminate state support for three-state checkboxes:
          </p>
          {Code.format(`
            import { CheckboxEditor } from '@basis/react'

            function MyComponent() {
              const [state, setState] = React.useState<boolean | null>(null)

              return (
                <CheckboxEditor
                  value={state}
                  allowIndeterminate={true}
                  onChange={setState}
                >
                  Select all items
                </CheckboxEditor>
              )
            }
          `)}
          <p>
            <strong>State Cycling:</strong>
          </p>
          <ul>
            <li><strong>Without <code>allowIndeterminate</code></strong>: Simple <code>true ↔ false</code> toggle</li>
            <li>
              <strong>With <code>allowIndeterminate</code></strong>:
              Three-state cycle <code>true → false → null → true</code>
            </li>
          </ul>
        </Section>
        <Section title="Advanced Features">
          <h4>Form Integration</h4>
          <p>
            CheckboxEditor integrates seamlessly with HTML forms:
          </p>
          {Code.format(`
            <form onSubmit={handleSubmit}>
              <CheckboxEditor
                value={agreed}
                onChange={setAgreed}
                field="terms"
              >
                I agree to the terms and conditions
              </CheckboxEditor>
              <button type="submit">Submit</button>
            </form>
          `)}
          <h4>Accessibility</h4>
          <p>
            CheckboxEditor provides comprehensive accessibility support:
          </p>
          <ul>
            <li>Uses semantic <code>&lt;label&gt;</code> element for proper labeling</li>
            <li>Hidden checkbox maintains keyboard navigation and screen reader support</li>
            <li>Supports <code>aria-label</code>, <code>aria-describedby</code>, and other ARIA attributes</li>
            <li>
              Proper <code>aria-checked</code> states:{' '}
              <code>true</code>, <code>false</code>, or <code>mixed</code> for indeterminate
            </li>
            <li>Focus management with visible focus indicators</li>
            <li>Proper indeterminate state handling for screen readers</li>
            <li>Form integration with <code>name</code> attribute for form submission</li>
          </ul>
        </Section>
        <Section title="API Reference">
          <h4>CheckboxEditor Props</h4>
          <ul>
            <li><code>allowIndeterminate?: boolean</code> - Enable three-state support (default: false)</li>
          </ul>
          <h4>Inherited from Editor</h4>
          <ul>
            <li><code>children?: React.ReactNode</code> - Content rendered inside the label</li>
            <li><code>className?: string</code> - Additional CSS classes</li>
            <li><code>disabled?: boolean</code> - Whether the checkbox is disabled</li>
            <li><code>field?: string</code> - Form field name</li>
            <li><code>onChange: (value: boolean | null) =&gt; void</code> - Change handler</li>
            <li><code>readOnly?: boolean</code> - Whether the checkbox is read-only</li>
            <li><code>value: boolean | null</code> - Current checkbox state</li>
          </ul>
        </Section>
      </>
    )
  }
}
