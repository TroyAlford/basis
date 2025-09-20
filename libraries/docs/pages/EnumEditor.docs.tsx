import * as React from 'react'
import { EnumEditor, Section, ToggleEditor } from '@basis/react'
import { Code } from '../components/Code'
import { Documentation } from '../components/Documentation'

// Sample enum for demonstration
enum SampleStatus {
  Archived = 'archived',
  Draft = 'draft',
  Published = 'published',
}

enum SamplePriority {
  Low = 1,
  Medium = 2,
  High = 3,
  Critical = 4,
}

interface ConfigState {
  closeOnActivate: boolean,
  enumType: 'status' | 'priority',
  priorityValue: SamplePriority,
  readOnly: boolean,
  statusValue: SampleStatus,
}

export class EnumEditorDocs extends Documentation<ConfigState> {
  state = {
    current: {
      closeOnActivate: true,
      enumType: 'status' as const,
      priorityValue: SamplePriority.Low,
      readOnly: false,
      statusValue: SampleStatus.Draft,
    },
  }

  content(): React.ReactNode {
    const { closeOnActivate, enumType, priorityValue, readOnly, statusValue } = this.current

    return (
      <>
        <h1>EnumEditor</h1>
        <Section>
          <p>
            EnumEditor converts TypeScript enums into user-friendly dropdown menus. It automatically
            generates formatted options from enum objects, handles both string and numeric enums, and
            provides consistent keyboard navigation and accessibility.
          </p>
        </Section>
        <Section title="Key Features">
          <ul>
            <li><strong>Automatic Option Generation</strong>: Converts enum objects into formatted dropdown options</li>
            <li>
              <strong>TitleCase Formatting</strong>:
              Converts enum names to readable labels (e.g., "camelCase" → "Camel Case")
            </li>
            <li><strong>Value Sorting</strong>: Options sorted by enum values for consistent ordering</li>
            <li><strong>Type Safety</strong>: Full TypeScript support with proper generic inference</li>
          </ul>
        </Section>
        <Section title="Interactive Demo">
          <div style={{ display: 'grid', gap: '2rem', gridTemplateColumns: '300px 1fr' }}>
            {/* Configuration Menu */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <strong>Enum Type</strong>
                <select
                  style={{ padding: '0.5rem', width: '100%' }}
                  value={enumType}
                  onChange={e => this.handleField(e.target.value as ConfigState['enumType'], 'enumType')}
                >
                  <option value="status">Status (string enum)</option>
                  <option value="priority">Priority (numeric enum)</option>
                </select>
              </div>
              <div>
                <strong>Close on Activate</strong>
                <div style={{ marginTop: '0.5rem' }}>
                  <ToggleEditor
                    field="closeOnActivate"
                    off="Keep Open"
                    on="Close on Activate"
                    value={closeOnActivate}
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
                <strong>Current Value</strong>
                <div style={{
                  background: '#f8f9fa',
                  border: '1px solid #dee2e6',
                  borderRadius: '4px',
                  fontSize: '0.875rem',
                  padding: '0.5rem',
                }}
                >
                  {String(enumType === 'status' ? statusValue : priorityValue)}
                </div>
              </div>
            </div>
            {/* Demo Area */}
            <div style={{ border: '1px solid #ccc', borderRadius: '4px', padding: '1rem' }}>
              {enumType === 'status' ? (
                <EnumEditor
                  closeOnActivate={closeOnActivate}
                  enum={SampleStatus}
                  field="statusValue"
                  readOnly={readOnly}
                  value={statusValue}
                  onChange={this.handleField}
                />
              ) : (
                <EnumEditor
                  closeOnActivate={closeOnActivate}
                  enum={SamplePriority}
                  field="priorityValue"
                  readOnly={readOnly}
                  value={priorityValue}
                  onChange={this.handleField}
                />
              )}

            </div>
          </div>
        </Section>
        <Section title="Usage Examples">
          <h3>String Enum</h3>
          {Code.format(`
            enum Status {
              Draft = 'draft',
              Published = 'published',
              Archived = 'archived',
            }

            <EnumEditor
              enum={Status}
              value={status}
              onChange={setStatus}
            />
          `)}
          <h3>Numeric Enum</h3>
          {Code.format(`
            enum Priority {
              Low = 1,
              Medium = 2,
              High = 3,
              Critical = 4,
            }

            <EnumEditor
              enum={Priority}
              value={priority}
              onChange={setPriority}
            />
          `)}
          <h3>With Form Integration</h3>
          {Code.format(`
            <EnumEditor
              enum={Status}
              field="status"
              value={formData.status}
              onChange={(value, field) => setFormData(prev => ({ ...prev, [field]: value }))}
            />
          `)}
        </Section>
        <Section title="Props">
          <p>
            EnumEditor extends the Editor pattern and uses DropdownMenu for dropdown functionality.
            For detailed information about controlled/uncontrolled modes and dropdown behavior,
            see the <a href="/dropdown-menu">DropdownMenu documentation</a>.
          </p>
          <ul>
            <li><strong><code>enum</code></strong>: The enum object to display options for (required)</li>
            <li><strong><code>value</code></strong>: Current selected enum value</li>
            <li><strong><code>onChange</code></strong>: Handler function called when selection changes</li>
            <li><strong><code>field</code></strong>: Field identifier for form management</li>
            <li><strong><code>readOnly</code></strong>: Whether the component is read-only</li>
            <li>
              <strong><code>closeOnActivate</code></strong>:
              Whether to close dropdown when option is selected (default: true)
            </li>
            <li><strong><code>initialValue</code></strong>: Initial value for uncontrolled mode</li>
          </ul>
        </Section>
        <Section title="How It Works">
          <p>
            EnumEditor automatically processes enum objects to create user-friendly options:
          </p>
          <h3>Title Case Conversion</h3>
          <p>
            Enum keys are converted to readable labels:
          </p>
          <ul>
            <li><code>draft</code> → <code>"Draft"</code></li>
            <li><code>camelCase</code> → <code>"Camel Case"</code></li>
            <li><code>kebab-case</code> → <code>"Kebab Case"</code></li>
            <li><code>snake_case</code> → <code>"Snake Case"</code></li>
          </ul>
          <h3>Value Sorting</h3>
          <p>
            Options are sorted by their enum values for consistent ordering:
          </p>
          {Code.format(`
            enum Priority {
              Critical = 4,  // Appears last
              Low = 1,       // Appears first
              Medium = 2,    // Appears second
              High = 3,      // Appears third
            }
          `)}
        </Section>
        <Section title="Accessibility">
          <p>
            EnumEditor inherits comprehensive keyboard navigation and accessibility support
            from <code>DropdownMenu</code>.
            For detailed information, see the <a href="/dropdown-menu">DropdownMenu</a> documentation.
          </p>
        </Section>
        <Section title="Best Practices">
          <h3>Use Descriptive Enum Names</h3>
          {Code.format(`
            // Good - Clear, descriptive names
            enum UserRole {
              Administrator = 'admin',
              Moderator = 'mod',
              User = 'user',
            }

            // Avoid - Unclear names
            enum Role {
              A = 'admin',
              B = 'mod',
              C = 'user',
            }
          `)}
          <h3>Handle Edge Cases</h3>
          {Code.format(`
            <EnumEditor
              enum={Status}
              value={status || Status.Draft}
              onChange={setStatus}
            />
          `)}
        </Section>
        <Section title="Use Cases">
          <ul>
            <li><strong>Status Selection</strong>: Draft, Published, Archived states</li>
            <li><strong>Priority Levels</strong>: Low, Medium, High, Critical</li>
            <li><strong>User Roles</strong>: Admin, Moderator, User</li>
            <li><strong>Categories</strong>: Any predefined set of options</li>
            <li><strong>Settings</strong>: Theme, Language, Region selection</li>
          </ul>
          <p>
            Consider alternatives for complex multi-select, searchable options, or dynamic option lists.
          </p>
        </Section>
      </>
    )
  }
}
