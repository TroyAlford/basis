import * as React from 'react'
import { Router } from '@basis/react'
import { Code } from '../components/Code'

export class EditorDocs extends React.Component {
  render(): React.ReactNode {
    return (
      <>
        <h1>Editor</h1>
        <section>
          <p>
            The Editor class provides a powerful abstraction for building form input components with
            consistent controlled and uncontrolled behavior, field management, and change handling. It extends
            the <Router.Link to="/components/component">Component</Router.Link> base class to create a clean,
            simple foundation for any type of data editor.
          </p>
          <p>
            The Editor abstraction eliminates the complexity of managing form state, field identifiers,
            and change propagation while providing a consistent API that works seamlessly with form
            libraries and state management systems.
          </p>
        </section>
        <section>
          <h2>Key Benefits</h2>
          <ul>
            <li>
              <strong>Dual Mode Support</strong>:
              Automatic controlled/uncontrolled mode switching based on whether <code>value</code> prop is provided
            </li>
            <li>
              <strong>Field Management</strong>:
              Built-in field identification that bubbles up through <code>onChange</code> callbacks
            </li>
            <li>
              <strong>Consistent API</strong>:
              Standardized <code>handleChange</code> method and <code>onChange</code> callback signature
            </li>
            <li>
              <strong>Smart Updates</strong>:
              Automatic deep equality checking to prevent unnecessary re-renders and callbacks
            </li>
            <li>
              <strong>Read-Only Support</strong>:
              Built-in read-only mode with customizable rendering
            </li>
          </ul>
        </section>
        <section>
          <h2>The Editor Abstraction in Practice</h2>
          <p>
            The Editor class makes creating powerful input components surprisingly simple. Here's how it works:
          </p>
          <h3>Core Concepts</h3>
          <p>
            Every Editor automatically handles:
          </p>
          <ul>
            <li><strong>Value Management</strong>: Controlled vs uncontrolled mode detection</li>
            <li><strong>Field Identification</strong>: Automatic field name propagation</li>
            <li><strong>Change Handling</strong>: Consistent onChange callback pattern</li>
            <li><strong>State Updates</strong>: Smart state management with deep equality checking</li>
          </ul>
          <h3>Simple Editor Implementation</h3>
          <p>
            Creating a basic editor is incredibly straightforward:
          </p>
          {Code.format(`
            export class SimpleEditor extends Editor<string> {
              static displayName = 'SimpleEditor'

              content(): React.ReactNode {
                return (
                  <input
                    type="text"
                    value={this.current || ''}
                    onChange={(e) => this.handleChange(e.target.value)}
                  />
                )
              }
            }
          `)}
          <p>
            This minimal implementation automatically provides:
          </p>
          <ul>
            <li>Controlled/uncontrolled mode switching</li>
            <li>Field identification and propagation</li>
            <li>Consistent onChange callback handling</li>
            <li>Read-only mode support</li>
            <li>Deep equality checking for performance</li>
          </ul>
          <h3>Field-Based Data Flow</h3>
          <p>
            The <code>field</code> prop creates a powerful pattern for form management:
          </p>
          {Code.format(`
            // Parent form component
            const handleFormChange = (value, field, editor) => {
              setFormData(prev => ({
                ...prev,
                [field]: value
              }))
            }

            // Multiple editors with automatic field identification
            <SimpleEditor field="firstName" onChange={handleFormChange} />
            <SimpleEditor field="lastName" onChange={handleFormChange} />
            <SimpleEditor field="email" onChange={handleFormChange} />
          `)}
          <p>
            Each editor automatically identifies itself and bubbles up changes with the field name,
            making form state management trivial.
          </p>
        </section>
        <section>
          <h2>Concrete Editor Examples</h2>
          <h3>TextEditor - Multiline Support</h3>
          <p>
            The TextEditor shows how to extend Editor for complex input types:
          </p>
          {Code.format(`
            export class TextEditor extends Editor<string, HTMLInputElement | HTMLTextAreaElement, Props> {
              static displayName = 'TextEditor'

              content(): React.ReactNode {
                const input = this.props.multiline !== false ? (
                  <textarea
                    value={this.current || ''}
                    onChange={(e) => this.handleChange(e.target.value)}
                    rows={typeof this.props.multiline === 'number' ? this.props.multiline : undefined}
                  />
                ) : (
                  <input
                    type="text"
                    value={this.current || ''}
                    onChange={(e) => this.handleChange(e.target.value)}
                  />
                )
                
                return super.content(input)
              }
            }
          `)}
          <p>
            Key benefits of this implementation:
          </p>
          <ul>
            <li>Automatic controlled/uncontrolled mode</li>
            <li>Field identification through <code>super.content()</code></li>
            <li>Consistent change handling</li>
            <li>Read-only mode support via Editor base</li>
          </ul>
          <h3>NumberEditor - Specialized Input</h3>
          <p>
            NumberEditor demonstrates advanced Editor usage with custom parsing and formatting:
          </p>
          {Code.format(`
            export class NumberEditor extends Editor<number, HTMLInputElement, Props> {
              static displayName = 'NumberEditor'

              // Custom input value formatting
              protected get inputValue(): string {
                if (this.current === null || this.current === undefined) return ''
                return this.current === 0 ? '' : this.formatNumber(this.current)
              }

              // Custom change handling with parsing
              #handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
                const value = event.target.value
                const numberValue = this.parseNumber(value)
                this.handleChange(numberValue) // Editor handles the rest
              }

              content(): React.ReactNode {
                return super.content(
                  <input
                    type="text"
                    value={this.inputValue}
                    onChange={this.#handleChange}
                  />
                )
              }
            }
          `)}
          <p>
            This editor shows how Editor handles:
          </p>
          <ul>
            <li>Type conversion (string → number)</li>
            <li>Custom formatting and parsing</li>
            <li>Automatic field propagation</li>
            <li>Consistent onChange callback pattern</li>
          </ul>
        </section>
        <section>
          <h2>Advanced Editor Patterns</h2>
          <h3>Nested Field Updates</h3>
          <p>
            Editor provides built-in support for updating nested object fields:
          </p>
          {Code.format(`
            export class ObjectEditor extends Editor<Record<string, any>> {
              updateNestedField = (path: string, value: any) => {
                // Editor automatically handles the update and onChange callback
                this.handleField(value, path)
              }
            }

            // Usage
            const editor = new ObjectEditor({
              value: { user: { name: 'John', age: 30 } },
              onChange: (value, field) => console.log('Updated:', value)
            })

            // Updates nested field and triggers onChange
            editor.updateNestedField('user.name', 'Jane')
          `)}
          <h3>Custom Read-Only Rendering</h3>
          <p>
            Override the <code>readOnly()</code> method for custom display:
          </p>
          {Code.format(`
            export class RichTextEditor extends Editor<string> {
              readOnly(): React.ReactNode {
                const value = this.current || ''
                return (
                  <div 
                    className="rich-text-display"
                    dangerouslySetInnerHTML={{ __html: value }}
                  />
                )
              }
            }
          `)}
        </section>
        <section>
          <h2>When to Use Editor</h2>
          <p>
            The Editor class is ideal for:
          </p>
          <ul>
            <li><strong>Form Inputs</strong>: Text fields, number inputs, selectors, and custom inputs</li>
            <li><strong>Data Editors</strong>: JSON editors, configuration panels, and data entry forms</li>
            <li><strong>Rich Inputs</strong>: Markdown editors, code editors, and rich text inputs</li>
            <li><strong>Custom Controls</strong>: Sliders, color pickers, and specialized input widgets</li>
            <li><strong>Form Libraries</strong>: Building components for form management systems</li>
          </ul>
          <p>
            Consider using Component directly when:
          </p>
          <ul>
            <li>Building display-only components that don't need input handling</li>
            <li>Creating components that don't fit the editor pattern</li>
            <li>Building components that need custom state management patterns</li>
          </ul>
        </section>
        <section>
          <h2>Migration from Custom Input Components</h2>
          <p>
            Converting existing input components to use Editor:
          </p>
          {Code.format(`
            // Before: Custom input component
            class OldInput extends React.Component<Props, State> {
              state = { value: this.props.value || this.props.initialValue || '' }
              
              handleChange = (newValue) => {
                this.setState({ value: newValue })
                this.props.onChange?.(newValue, this.props.field)
              }
            }

            // After: Editor-based component
            class NewInput extends Editor<string> {
              content(): React.ReactNode {
                return (
                  <input
                    value={this.current || ''}
                    onChange={(e) => this.handleChange(e.target.value)}
                  />
                )
              }
            }
          `)}
          <p>
            Benefits of the conversion:
          </p>
          <ul>
            <li>Automatic controlled/uncontrolled mode</li>
            <li>Built-in field identification</li>
            <li>Consistent onChange callback pattern</li>
            <li>Read-only mode support</li>
            <li>Better performance with deep equality checking</li>
          </ul>
        </section>
      </>
    )
  }
}
