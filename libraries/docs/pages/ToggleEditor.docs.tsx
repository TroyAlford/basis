import * as React from 'react'
import { Padlock } from '@basis/react'
import { Section, ToggleEditor } from '@basis/react'
import { TextEditor } from '../../react/components/TextEditor/TextEditor'
import { Code } from '../components/Code'
import { Documentation } from '../components/Documentation'

interface ConfigState {
  customText: string,
  height: string,
  readOnly: boolean,
  toggleValue: boolean,
  width: string,
}

export class ToggleEditorDocs extends Documentation<ConfigState> {
  state = {
    current: {
      customText: 'Enable notifications',
      height: '1em',
      readOnly: false,
      toggleValue: true,
      width: '1em',
    },
  }

  content(): React.ReactNode {
    const { customText, readOnly, toggleValue } = this.current

    return (
      <>
        <h1>ToggleEditor</h1>
        <Section>
          <p>
            ToggleEditor is a simple boolean toggle component that extends the Editor base class to provide
            a clickable toggle with optional icons and text. It automatically handles keyboard navigation,
            accessibility, and provides a consistent API for boolean state management.
          </p>
          <p>
            Built on the Editor pattern, ToggleEditor supports both controlled and uncontrolled modes, making it
            perfect for settings panels, feature toggles, and any interface requiring simple on/off state
            with proper accessibility and keyboard navigation.
          </p>
        </Section>
        <Section title="Key Features">
          <ul>
            <li><strong>Boolean Toggle</strong>: Simple on/off state management</li>
            <li><strong>Icon Support</strong>: Custom icons for on/off states</li>
            <li><strong>Text Labels</strong>: Optional text alongside the toggle</li>
            <li><strong>Keyboard Navigation</strong>: Space and Enter keys for activation</li>
            <li><strong>Custom Dimensions</strong>: Configurable height and width</li>
            <li><strong>Editor Pattern</strong>: Follows the same controlled/uncontrolled pattern as other Editors</li>
          </ul>
        </Section>
        <Section title="Interactive Demo">
          <div style={{ display: 'grid', gap: '2rem', gridTemplateColumns: '300px 1fr' }}>
            {/* Configuration Menu */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <strong>Toggle State</strong>
                <div style={{ marginTop: '0.5rem' }}>
                  <ToggleEditor
                    field="toggleValue"
                    value={toggleValue}
                    onChange={this.handleField}
                  />
                </div>
              </div>
              <div>
                <strong>Read Only</strong>
                <div style={{ marginTop: '0.5rem' }}>
                  <ToggleEditor
                    field="readOnly"
                    off="Editable"
                    on="Read Only"
                    value={readOnly}
                    onChange={this.handleField}
                  />
                </div>
              </div>
              <div>
                <strong>Custom Text</strong>
                <TextEditor
                  field="customText"
                  placeholder="Toggle label"
                  value={customText}
                  onChange={this.handleField}
                />
              </div>
              <div>
                <strong>Current Value</strong>
                <div style={{
                  background: '#f8f9fa',
                  border: '1px solid #dee2e6',
                  borderRadius: '4px',
                  fontSize: '0.875rem',
                  padding: '0.5rem',
                }}
                >
                  {String(toggleValue)}
                </div>
              </div>
            </div>
            {/* Demo Area */}
            <div style={{ border: '1px solid #ccc', borderRadius: '4px', padding: '1rem' }}>
              <h3>Live ToggleEditor</h3>
              <ToggleEditor
                aria-label="Demo toggle"
                field="toggleValue"
                readOnly={readOnly}
                value={toggleValue}
                onChange={this.handleField}
              />
              <h3>Always Read Only</h3>
              <ToggleEditor
                readOnly
                aria-label="Always read-only toggle"
                value={toggleValue}
              />
              <h3>With Custom Icons</h3>
              <ToggleEditor
                aria-label="Toggle with icons"
                off={<Padlock.Unlocked filled />}
                on={<Padlock.Locked filled />}
                value={toggleValue}
                onChange={this.handleField}
              />
            </div>
          </div>
        </Section>
        <Section title="Usage Examples">
          <h3>Basic Toggle</h3>
          {Code.format(`
            <ToggleEditor
              value={isEnabled}
              onChange={(value) => setIsEnabled(value)}
            />
          `)}
          <h3>Toggle with Text</h3>
          {Code.format(`
            <ToggleEditor
              value={isEnabled}
              onChange={(value) => setIsEnabled(value)}
            />
          `)}
          <h3>Toggle with Custom Icons</h3>
          {Code.format(`
            <ToggleEditor
              value={isDarkMode}
              on={<Sun />}
              off={<Moon />}
              onChange={(value) => setIsDarkMode(value)}
            />
          `)}
          <h3>Custom Dimensions</h3>
          {Code.format(`
            <ToggleEditor
              value={isEnabled}
              height="2em"
              width="2em"
              onChange={(value) => setIsEnabled(value)}
            />
          `)}
          <h3>Read-only Mode</h3>
          {Code.format(`
            <ToggleEditor
              value={isEnabled}
              readOnly={true}
            />
          `)}
        </Section>
        <Section title="Replacing Nerdrage ToggleEditor">
          <p>
            ToggleEditor is designed as a drop-in replacement for the nerdrage ToggleEditor component.
            Here's how to migrate:
          </p>
          <h3>Before (Nerdrage)</h3>
          {Code.format(`
            import { ToggleEditor } from '@nerdrage/components'

            <ToggleEditor
              value={isEnabled}
              onChange={(value) => setIsEnabled(value)}
              iconOn={CheckIcon}
              iconOff={BlankIcon}
            />
          `)}
          <h3>After (Basis)</h3>
          {Code.format(`
            import { ToggleEditor } from '@basis/react'

            <ToggleEditor
              value={isEnabled}
              onChange={(value) => setIsEnabled(value)}
              on={<CheckIcon />}
              off={<BlankIcon />}
            />
          `)}
          <h3>Migration Benefits</h3>
          <ul>
            <li><strong>Consistent API</strong>: Same pattern as other Editor components</li>
            <li><strong>Better Accessibility</strong>: Built-in ARIA attributes and keyboard navigation</li>
            <li><strong>Type Safety</strong>: Full TypeScript support</li>
            <li><strong>Simplified Props</strong>: Cleaner prop names (on/off instead of iconOn/iconOff)</li>
            <li><strong>Customizable Styling</strong>: CSS variables for easy theming</li>
          </ul>
        </Section>
        <Section title="Key Props">
          <p>
            ToggleEditor supports both controlled and uncontrolled modes. Use <code>value</code> for controlled
            mode where you manage the state, or <code>initialValue</code> for uncontrolled mode where the
            component manages its own state.
          </p>
          <h3>Core Props</h3>
          <ul>
            <li><strong><code>value</code></strong>: Current boolean state</li>
            <li><strong><code>onChange</code></strong>: Handler function called when toggle state changes</li>
            <li><strong><code>text</code></strong>: Optional text label to display alongside the toggle</li>
            <li><strong><code>readOnly</code></strong>: Whether the component is read-only</li>
          </ul>
          <h3>Icon Props</h3>
          <ul>
            <li><strong><code>on</code></strong>: React element to display when toggle is on</li>
            <li><strong><code>off</code></strong>: React element to display when toggle is off</li>
          </ul>
          <h3>Dimension Props</h3>
          <ul>
            <li><strong><code>height</code></strong>: Height of the toggle icon (default: '1em')</li>
            <li><strong><code>width</code></strong>: Width of the toggle icon (default: '1em')</li>
          </ul>
        </Section>
        <Section title="Keyboard Navigation">
          <p>ToggleEditor provides keyboard navigation:</p>
          <ul>
            <li><strong>Space</strong>: Toggle the state</li>
            <li><strong>Enter</strong>: Toggle the state</li>
            <li><strong>Tab</strong>: Focus the component</li>
          </ul>
          <p>
            The component automatically handles focus management and ensures that keyboard navigation
            works seamlessly with screen readers and other assistive technologies.
          </p>
        </Section>
        <Section title="Accessibility Features">
          <p>ToggleEditor includes comprehensive accessibility support:</p>
          <ul>
            <li><strong>ARIA Attributes</strong>: Automatically sets <code>aria-pressed</code> to indicate state</li>
            <li><strong>Labels</strong>: Proper <code>aria-label</code> and <code>aria-labelledby</code> support</li>
            <li><strong>Focus Management</strong>: Keyboard navigation with proper focus indicators</li>
            <li><strong>Screen Reader Support</strong>: Semantic HTML with proper labeling</li>
            <li><strong>Disabled States</strong>: Proper handling of read-only mode</li>
          </ul>
        </Section>
        <Section title="Styling & Theming">
          <p>
            ToggleEditor uses CSS custom properties for theming. All styles are prefixed with{' '}
            <code>--basis-toggle-*</code> and can be customized:
          </p>
          {Code.format(`
            :root {
              --basis-toggle-background: transparent;
              --basis-toggle-background-hover: var(--basis-color-background-hover);
              --basis-toggle-border-radius: var(--basis-radius-sm);
              --basis-color-primary: #007bff;
            }
          `)}
          <p>
            This allows for easy customization while maintaining consistency with your design system.
          </p>
        </Section>
        <Section title="Best Practices">
          <h3>Use Descriptive Text</h3>
          <p>Always provide clear, descriptive text for your toggles:</p>
          {Code.format(`
            // Good - Clear, descriptive text
            <ToggleEditor
              value={notificationsEnabled}
              text="Enable email notifications"
              onChange={setNotificationsEnabled}
            />

            // Avoid - Unclear text
            <ToggleEditor
              value={setting}
              text="Setting"
              onChange={setSetting}
            />
          `)}
          <h3>Use Meaningful Icons</h3>
          <p>Choose icons that clearly represent the on/off states:</p>
          {Code.format(`
            // Good - Clear visual distinction
            <ToggleEditor
              value={soundEnabled}
              on={<VolumeOn />}
              off={<VolumeOff />}
              onChange={setSoundEnabled}
            />

            // Avoid - Unclear distinction
            <ToggleEditor
              value={setting}
              on={<IconA />}
              off={<IconB />}
              onChange={setSetting}
            />
          `)}
        </Section>
      </>
    )
  }
}
