import * as React from 'react'
import { OptionGroup, Section, ToggleEditor } from '@basis/react'
import { TextEditor } from '../../react/components/TextEditor/TextEditor'
import { Orientation } from '../../react/types/Orientation'
import { Code } from '../components/Code'
import { Documentation } from '../components/Documentation'

interface ConfigState {
  customOptions: string,
  multiple: boolean,
  orientation: Orientation,
  readOnly: boolean,
  selectedValue: string | string[],
}

export class OptionGroupDocs extends Documentation<ConfigState> {
  state = {
    current: {
      customOptions: 'option1,option2,option3',
      multiple: false,
      orientation: Orientation.Vertical,
      readOnly: false,
      selectedValue: 'option2',
    },
  }

  handleMultipleToggle = (): void => {
    this.handleField(!this.current.multiple, 'multiple')
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
    const { customOptions, multiple, orientation, readOnly, selectedValue } = this.current

    return (
      <>
        <h1>OptionGroup</h1>
        <Section title="Overview">
          <p>
            OptionGroup is a flexible option selection component that extends the Editor base class to provide
            either radio button groups (single selection) or checkbox groups (multiple selection). It automatically
            handles keyboard navigation, accessibility, and provides a consistent API for both selection modes.
          </p>
          <p>
            Built on the Editor pattern, OptionGroup supports both controlled and uncontrolled modes, making it
            perfect for forms, settings panels, and any interface requiring option selection with proper
            accessibility and keyboard navigation.
          </p>
        </Section>
        <Section title="Key Features">
          <ul>
            <li><strong>Dual Selection Modes</strong>: Toggle between radio buttons and checkboxes</li>
            <li><strong>Generic Type Support</strong>: Works with any value type (string, number, enum, etc.)</li>
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
                    field="multiple"
                    off="Radio Buttons"
                    on="Checkboxes"
                    value={multiple}
                    onChange={this.handleField}
                  />
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
                <strong>Orientation</strong>
                <div>
                  <OptionGroup field="orientation" value={orientation} onChange={this.handleField}>
                    <OptionGroup.Option value={Orientation.Horizontal}>Horizontal</OptionGroup.Option>
                    <OptionGroup.Option value={Orientation.Vertical}>Vertical</OptionGroup.Option>
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
                multiple={multiple}
                orientation={orientation}
                readOnly={readOnly}
                value={selectedValue}
                onChange={this.handleField}
              >
                {this.options.map(value => (
                  <OptionGroup.Option key={value} value={value}>{value}</OptionGroup.Option>
                ))}
              </OptionGroup>
            </div>
          </div>
        </Section>
        <Section title="Usage Examples">
          <h3>Basic Radio Group (Single Selection)</h3>
          {Code.format(`
            <OptionGroup
              multiple={false}
              value="editor"
              onChange={(value) => setRole(value)}
            >
              <OptionGroup.Option value="public">Public</OptionGroup.Option>
              <OptionGroup.Option value="player">Player</OptionGroup.Option>
              <OptionGroup.Option value="editor">Editor</OptionGroup.Option>
              <OptionGroup.Option value="owner">Storyteller</OptionGroup.Option>
            </OptionGroup>
          `)}
          <h3>Checkbox Group (Multiple Selection)</h3>
          {Code.format(`
            <OptionGroup
              multiple={true}
              value={['read', 'write']}
              onChange={(values) => setPermissions(values)}
            >
              <OptionGroup.Option value="read">Read</OptionGroup.Option>
              <OptionGroup.Option value="write">Write</OptionGroup.Option>
              <OptionGroup.Option value="admin">Admin</OptionGroup.Option>
            </OptionGroup>
          `)}
          <h3>Horizontal Layout</h3>
          {Code.format(`
            <OptionGroup
              multiple={false}
              orientation="horizontal"
              value="option1"
              onChange={handleChange}
            >
              <OptionGroup.Option value="option1">Option 1</OptionGroup.Option>
              <OptionGroup.Option value="option2">Option 2</OptionGroup.Option>
              <OptionGroup.Option value="option3">Option 3</OptionGroup.Option>
            </OptionGroup>
          `)}
          <h3>With Disabled Options</h3>
          {Code.format(`
            <OptionGroup
              multiple={false}
              value="option1"
              onChange={handleChange}
            >
              <OptionGroup.Option value="option1">Option 1</OptionGroup.Option>
              <OptionGroup.Option value="option2" disabled>Option 2</OptionGroup.Option>
              <OptionGroup.Option value="option3">Option 3</OptionGroup.Option>
            </OptionGroup>
          `)}
          <h3>Generic Types</h3>
          {Code.format(`
            <OptionGroup<number>
              multiple={false}
              value={2}
              onChange={(value: number) => setNumber(value)}
            >
              <OptionGroup.Option value={1}>One</OptionGroup.Option>
              <OptionGroup.Option value={2}>Two</OptionGroup.Option>
              <OptionGroup.Option value={3}>Three</OptionGroup.Option>
            </OptionGroup>
          `)}
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
            <li><strong><code>orientation</code></strong>: 'horizontal' or 'vertical' layout</li>
            <li><strong><code>value</code></strong>: Current selection (string for single, array for multiple)</li>
            <li><strong><code>onChange</code></strong>: Handler function called when selection changes</li>
          </ul>
          <h3>OptionGroup.Option Props</h3>
          <ul>
            <li><strong><code>value</code></strong>: The value for this option (any type)</li>
            <li><strong><code>children</code></strong>: Display content for this option (text, icons, etc.)</li>
            <li><strong><code>disabled</code></strong>: Whether this option is disabled</li>
            <li><strong><code>inputProps</code></strong>: Additional props for the input element</li>
          </ul>
        </Section>
        <Section title="Keyboard Navigation">
          <p>OptionGroup provides comprehensive keyboard navigation:</p>
          <ul>
            <li><strong>Arrow Keys (↑↓←→)</strong>: Navigate between options</li>
            <li><strong>Space</strong>: Toggle checkbox selection (multiple mode)</li>
            <li><strong>Home/End</strong>: Jump to first/last option</li>
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
            <li><strong>Labels</strong>: Proper <code>aria-label</code> and <code>aria-labelledby</code> support</li>
            <li><strong>Focus Management</strong>: Keyboard navigation with proper focus indicators</li>
            <li><strong>Screen Reader Support</strong>: Semantic HTML with proper labeling</li>
            <li><strong>Disabled States</strong>: Proper handling of disabled options</li>
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
