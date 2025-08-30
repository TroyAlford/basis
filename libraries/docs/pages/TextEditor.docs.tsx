import * as React from 'react'
import { Link } from '../../react/components/Router/Link'
import { TextEditor } from '../../react/components/TextEditor/TextEditor'
import { Code } from '../components/Code'

interface State {
  multiline: TextEditor['props']['multiline'],
  wrap: TextEditor['props']['wrap'],
}

export class TextEditorDocs extends React.Component<unknown, State> {
  state: State = {
    multiline: false,
    wrap: TextEditor.Wrap.Soft,
  }

  render(): React.ReactNode {
    return (
      <>
        <h1>TextEditor</h1>
        <section>
          <p>
            TextEditor is a powerful text input component that extends the Editor base class to provide
            flexible text editing capabilities. It automatically handles single-line and multi-line input,
            with support for auto-growing textareas and customizable text wrapping.
          </p>
        </section>
        <section>
          <h2>Key Features</h2>
          <ul>
            <li><strong>Flexible Input Types</strong>: Automatically switches between input and textarea</li>
            <li>
              <strong>Multiline Modes</strong>:
              Support for auto-growing, fixed line count, and resizable textareas
            </li>
            <li><strong>Text Wrapping</strong>: Configurable text wrapping behavior for textareas</li>
            <li><strong>Focus Management</strong>: Built-in auto-focus and select-on-focus capabilities</li>
            <li>
              <strong>Mixin Integration</strong>:
              Built-in support for accessibility, focusable, prefix/suffix, and placeholder features
            </li>
          </ul>
        </section>
        <section>
          <h2>Interactive Demo</h2>
          <div style={{ display: 'grid', gap: '2rem', gridTemplateColumns: '300px 1fr' }}>
            {/* Configuration Menu */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <h4>Multiline Mode</h4>
                <select
                  defaultValue="false"
                  style={{ padding: '0.5rem', width: '100%' }}
                  onChange={e => this.setState({ multiline: e.target.value as State['multiline'] })}
                >
                  <option value="false">Single Line (input)</option>
                  <option value="true">Multiline (textarea)</option>
                  <option value="auto">Auto-growing</option>
                  <option value="3">Fixed 3 lines</option>
                </select>
              </div>
              <div>
                <h4>Text Wrapping</h4>
                <select
                  defaultValue="soft"
                  style={{ padding: '0.5rem', width: '100%' }}
                  onChange={e => this.setState({ wrap: e.target.value as State['wrap'] })}
                >
                  <option value="soft">Soft (word boundaries)</option>
                  <option value="hard">Hard (character boundaries)</option>
                  <option value="off">Off (no wrapping)</option>
                </select>
              </div>
            </div>
            {/* Demo Area */}
            <div style={{ border: '1px solid #ccc', borderRadius: '4px', padding: '1rem' }}>
              <TextEditor
                field="demo"
                multiline={this.state?.multiline || false}
                placeholder="Type here to see the TextEditor in action..."
              />
            </div>
          </div>
        </section>
        <section>
          <h2>Usage Examples</h2>
          <h3>Basic Single-Line Input</h3>
          {Code.format(`
            <TextEditor
              field="username"
              placeholder="Enter username"
              onChange={(value, field) => setFormData(prev => ({ ...prev, [field]: value }))}
            />
          `)}
          <h3>Multiline Textarea</h3>
          {Code.format(`
            <TextEditor
              field="description"
              multiline="auto"
              placeholder="Enter description..."
              onChange={(value, field) => setFormData(prev => ({ ...prev, [field]: value }))}
            />
          `)}
        </section>
        <section>
          <h2>Key Props</h2>
          <p>
            TextEditor supports both controlled and uncontrolled modes. Use <code>value</code> for controlled
            mode where you manage the state, or <code>initialValue</code> for uncontrolled mode where the
            component manages its own state.
          </p>
          <p>
            The <code>multiline</code> prop controls whether the component renders as an input or textarea,
            with options for auto-growing, fixed line counts, or standard textarea behavior.
            The <code>wrap</code> prop configures text wrapping for multiline textareas.
          </p>
          <h3><code>multiline</code></h3>
          <p>
            Controls the multiline behavior of the TextEditor:
          </p>
          <ul>
            <li><strong>false (default)</strong>: Renders as a single-line <code>input[type="text"]</code> element</li>
            <li><strong>true</strong>: Renders as a <code>textarea</code> with normal browser resizing</li>
            <li><strong>'auto'</strong>: Renders as a <code>textarea</code> that automatically grows in height</li>
            <li><strong>number</strong>: Renders as a <code>textarea</code> with a fixed number of lines</li>
          </ul>
          <h3><code>wrap</code></h3>
          <p>
            Configures text wrapping behavior for multiline textareas:
          </p>
          <ul>
            <li><strong>soft (default)</strong>: Wraps at word boundaries</li>
            <li><strong>hard</strong>: Wraps at character boundaries</li>
            <li><strong>off</strong>: No text wrapping</li>
          </ul>
          <h3>Mixin System</h3>
          <p>
            TextEditor uses the Component class's mixin system for enhanced functionality. For detailed
            information about each mixin, see the <Link to="/mixins">Mixins documentation</Link>.
          </p>
          {Code.format(`
            export class TextEditor extends Editor<string, HTMLInputElement | HTMLTextAreaElement, Props> {
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

      </>
    )
  }
}
