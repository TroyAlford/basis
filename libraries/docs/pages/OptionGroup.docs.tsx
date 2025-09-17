import * as React from 'react'
import { OptionGroup, Section, ToggleEditor } from '@basis/react'
import { TextEditor } from '../../react/components/TextEditor/TextEditor'
import { Orientation } from '../../react/types/Orientation'
import { Code } from '../components/Code'
import { Documentation } from '../components/Documentation'

interface ConfigState {
  customOptions: string,
  optionType: 'option' | 'toggle',
  orientation: Orientation,
  readOnly: boolean,
  selectedValue: string | string[],
}

export class OptionGroupDocs extends Documentation<ConfigState> {
  state = {
    current: {
      customOptions: 'option1,option2,option3',
      optionType: 'option' as const,
      orientation: Orientation.Vertical,
      readOnly: false,
      selectedValue: 'option2',
    },
  }

  handleOrientationChange = (orientation: Orientation): void => {
    this.handleField(orientation, 'orientation')
  }

  handleReadOnlyToggle = (): void => {
    this.handleField(!this.current.readOnly, 'readOnly')
  }

  get options() {
    return this.current.customOptions.split(',').map(option => option.trim())
  }

  content(): React.ReactNode {
    const { customOptions, optionType, orientation, readOnly, selectedValue } = this.current

    return (
      <>
        <h1>OptionGroup</h1>
        <Section title="Overview">
          <p>
            <code>OptionGroup</code> is a flexible option selection component that extends the Editor base class to
            provide either radio button groups (single selection) or checkbox groups (multiple selection). It
            automatically handles keyboard navigation, accessibility, and provides a consistent API for both selection
            modes.
          </p>
          <p>
            Built on the Editor pattern, <code>OptionGroup</code> supports both controlled and uncontrolled modes,
            making it perfect for forms, settings panels, and any interface requiring option selection with proper
            accessibility and keyboard navigation.
          </p>
        </Section>
        <Section title="Key Features">
          <ul>
            <li><strong>Dual Selection Modes</strong>: Toggle between radio buttons and checkboxes</li>
            <li>
              <strong>Generic Type Support</strong>: Works with any value type
              (<code>string</code>, <code>number</code>, <code>enum</code>, objects, etc.)
            </li>
            <li>
              <strong>Editor&lt;boolean&gt; Integration</strong>:
              Accepts any mix of <code>Editor&lt;boolean&gt;</code> components as children. The <code>data</code> prop
              determines the value returned when that editor is selected.
            </li>
            <li>
              <strong>Mixed Component Support</strong>:
              Combine <code>OptionGroup.Option</code> and <code>ToggleEditor</code> components in the same group
            </li>
            <li><strong>Keyboard Navigation</strong>: Arrow keys, Space, Home/End for full keyboard accessibility</li>
            <li><strong>Orientation Control</strong>: Horizontal or vertical layout options</li>
            <li><strong>Individual Disabling</strong>: Disable specific options while keeping others active</li>
            <li><strong>Editor Pattern</strong>: Follows the same controlled/uncontrolled pattern as other Editors</li>
          </ul>
        </Section>
        <Section title="Interactive Demo">
          <div style={{ display: 'grid', gap: '2rem', gridTemplateColumns: '300px 1fr' }}>
            {/* Configuration Menu */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <div>
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
                <strong>Option Type & Orientation</strong>
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <OptionGroup
                    field="optionType"
                    orientation={Orientation.Horizontal}
                    value={this.current.optionType}
                    onChange={this.handleField}
                  >
                    <ToggleEditor data="option" off="Option" on="Option" />
                    <ToggleEditor data="toggle" off="Toggle" on="Toggle" />
                  </OptionGroup>
                  <OptionGroup
                    field="orientation"
                    orientation={Orientation.Horizontal}
                    value={orientation}
                    onChange={this.handleField}
                  >
                    <ToggleEditor data={Orientation.Horizontal} off="Horizontal" on="Horizontal" />
                    <ToggleEditor data={Orientation.Vertical} off="Vertical" on="Vertical" />
                  </OptionGroup>
                </div>
              </div>
              <div>
                <strong>Available Options</strong>
                <TextEditor
                  field="customOptions"
                  placeholder="Separate options with commas"
                  value={customOptions}
                  onChange={this.handleField}
                />
              </div>
              <div>
                <strong>Current Selection</strong>
                <div style={{
                  background: '#f8f9fa',
                  border: '1px solid #dee2e6',
                  borderRadius: '4px',
                  fontSize: '0.875rem',
                  padding: '0.5rem',
                }}
                >
                  {Array.isArray(selectedValue)
                    ? `[${selectedValue.join(', ')}]`
                    : selectedValue}
                </div>
              </div>
            </div>
            {/* Demo Area */}
            <div style={{ border: '1px solid #ccc', borderRadius: '4px', padding: '1rem' }}>
              <h3>Live OptionGroup</h3>
              <OptionGroup
                field="selectedValue"
                multiple={false}
                orientation={orientation}
                readOnly={readOnly}
                value={selectedValue}
                onChange={this.handleField}
              >
                {this.options.map(value => (
                  optionType === 'toggle'
                    ? <ToggleEditor key={value} data={value} off={value} on={value} />
                    : <OptionGroup.Option key={value} data={value}>{value}</OptionGroup.Option>
                ))}
              </OptionGroup>
            </div>
          </div>
        </Section>
        <Section title="Usage Examples">
          <h3>Basic Usage</h3>
          {Code.format(`
            <OptionGroup
              value="editor"
              onChange={(value) => setRole(value)}
            >
              <OptionGroup.Option data="public">Public</OptionGroup.Option>
              <OptionGroup.Option data="player">Player</OptionGroup.Option>
              <OptionGroup.Option data="editor">Editor</OptionGroup.Option>
            </OptionGroup>
          `)}
          <h3>With ToggleEditor Components</h3>
          {Code.format(`
            <OptionGroup
              value="toggle1"
              onChange={(value) => setSelection(value)}
            >
              <ToggleEditor data="toggle1" off="Option 1" on="Option 1" />
              <ToggleEditor data="toggle2" off="Option 2" on="Option 2" />
              <ToggleEditor data="toggle3" off="Option 3" on="Option 3" />
            </OptionGroup>
          `)}
          <h3>Multiple Selection</h3>
          {Code.format(`
            <OptionGroup
              multiple
              value={['read', 'write']}
              onChange={(values) => setPermissions(values)}
            >
              <OptionGroup.Option data="read">Read</OptionGroup.Option>
              <OptionGroup.Option data="write">Write</OptionGroup.Option>
              <OptionGroup.Option data="admin">Admin</OptionGroup.Option>
            </OptionGroup>
          `)}
        </Section>
        <Section title="Editor&lt;boolean&gt; Integration">
          <p>
            <code>OptionGroup</code> accepts any <code>Editor&lt;boolean&gt;</code> component as children, not
            just <code>OptionGroup.Option</code>. This includes <code>ToggleEditor</code> and any other
            boolean editor you create.
          </p>
          <h3>How It Works</h3>
          <ul>
            <li>
              <strong>Data Prop</strong>: Each <code>Editor&lt;boolean&gt;</code> child must have
              a <code>data</code> prop that specifies the value to be returned when that editor is selected/checked.
            </li>
            <li>
              <strong>Selection State</strong>: <code>OptionGroup</code> manages which editors are "on" (true) or
              "off" (false) based on the current <code>value</code> prop.
            </li>
            <li>
              <strong>Return Values</strong>: When editors are selected, their <code>data</code> values are
              collected into a <code>Set</code> internally, then returned as either a single value (single selection)
              or an array (multiple selection).
            </li>
          </ul>
          <h3>Example</h3>
          {Code.format(`
            <OptionGroup
              value="toggle1"
              onChange={(value) => console.log(value)} // "toggle1"
            >
              <ToggleEditor data="toggle1" off="Option 1" on="Option 1" />
              <ToggleEditor data="toggle2" off="Option 2" on="Option 2" />
            </OptionGroup>
          `)}
          <p>
            In this example, when the first ToggleEditor is selected, the <code>data="toggle1"</code> value
            is returned to the <code>onChange</code> handler.
          </p>
        </Section>
        <Section title="Object Value Support">
          <p>
            The <code>data</code> prop can contain any value type, including complex objects. When an option
            is selected, the exact object reference is returned, allowing you to work with full objects
            rather than just scalar values.
          </p>
          <h3>Example with Objects</h3>
          {Code.format(`
            const userOptions = [
              { id: 1, name: 'Alice', role: 'admin' },
              { id: 2, name: 'Bob', role: 'user' },
              { id: 3, name: 'Charlie', role: 'moderator' }
            ]

            <OptionGroup
              value={userOptions[0]}
              onChange={(selectedUser) => {
                console.log(selectedUser.name) // "Alice"
                console.log(selectedUser.role)  // "admin"
                // selectedUser is the exact object reference
              }}
            >
              {userOptions.map(user => (
                <OptionGroup.Option key={user.id} data={user}>
                  {user.name} ({user.role})
                </OptionGroup.Option>
              ))}
            </OptionGroup>
          `)}
          <p>
            This pattern is particularly useful for forms where you need to select from a list of complex
            objects and want to work with the full object data rather than just an ID or name.
          </p>
        </Section>
        <Section title="Key Props">
          <p>
            OptionGroup supports both controlled and uncontrolled modes. Use <code>value</code> for controlled
            mode where you manage the state, or <code>initialValue</code> for uncontrolled mode where the
            component manages its own state.
          </p>
          <h3>Core Props</h3>
          <ul>
            <li><strong><code>multiple</code></strong>: Boolean to toggle between radio buttons and checkboxes</li>
            <li>
              <strong><code>onChange</code></strong>: Handler function called when selection changes.
              Returns the <code>data</code> values from selected editors.
            </li>
            <li><strong><code>orientation</code></strong>: 'horizontal' or 'vertical' layout</li>
            <li>
              <strong><code>value</code></strong>: Current selection (single value for single selection,
              array for multiple)
            </li>
          </ul>
          <h3>OptionGroup.Option Props</h3>
          <ul>
            <li><strong><code>children</code></strong>: Display content for this option (text, icons, etc.)</li>
            <li><strong><code>data</code></strong>: The value for this option (any type)</li>
            <li><strong><code>disabled</code></strong>: Whether this option is disabled</li>
            <li><strong><code>type</code></strong>: Input type ('radio' or 'checkbox') - automatically set</li>
          </ul>
        </Section>
        <Section title="Keyboard Navigation">
          <p>OptionGroup provides comprehensive keyboard navigation:</p>
          <ul>
            <li><strong>Arrow Keys (↑↓←→)</strong>: Navigate between options</li>
            <li><strong>Home/End</strong>: Jump to first/last option</li>
            <li><strong>Space</strong>: Toggle checkbox selection (multiple mode)</li>
            <li><strong>Tab</strong>: Focus the component</li>
          </ul>
          <p>
            The component automatically handles focus management and ensures that keyboard navigation
            works seamlessly with screen readers and other assistive technologies.
          </p>
        </Section>
        <Section title="Accessibility Features">
          <p>OptionGroup includes comprehensive accessibility support:</p>
          <ul>
            <li><strong>ARIA Roles</strong>: Automatically sets <code>radiogroup</code> or <code>group</code> roles</li>
            <li><strong>Disabled States</strong>: Proper handling of disabled options</li>
            <li><strong>Focus Management</strong>: Keyboard navigation with proper focus indicators</li>
            <li><strong>Labels</strong>: Proper <code>aria-label</code> and <code>aria-labelledby</code> support</li>
            <li><strong>Screen Reader Support</strong>: Semantic HTML with proper labeling</li>
          </ul>
        </Section>
        <Section title="Styling & Theming">
          <p>
            OptionGroup uses CSS custom properties for theming. All styles are prefixed with{' '}
            <code>--basis-option-*</code> and can be customized:
          </p>
          {Code.format(`
            :root {
              --basis-option-group-gap: 0.5rem;
              --basis-option-group-border: 1px solid var(--basis-color-border);
              --basis-option-group-background: var(--basis-color-background);
              --basis-option-input-size: 1rem;
              --basis-option-input-background-checked: var(--basis-color-primary);
              --basis-option-label-color: var(--basis-color-foreground);
              /* ... and many more */
            }
          `)}
          <p>
            This allows for easy customization while maintaining consistency with your design system.
          </p>
        </Section>
      </>
    )
  }
}
