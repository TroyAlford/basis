import * as React from 'react'
import { AnchorPoint } from '@basis/react/types/AnchorPoint'
import { Code } from '../../../docs/components/Code'
import { Link } from '../Router/Link'
import { AutoComplete } from './AutoComplete'

interface SearchResult {
  headline: string,
  id: string,
  preview: string,
  slug: string,
}

interface User {
  avatar?: string,
  email: string,
  id: string,
  name: string,
}

interface State {
  anchorPoint: AnchorPoint,
  minimumQueryLength: number,
}

export class AutoCompleteDocs extends React.Component<unknown, State> {
  state: State = {
    anchorPoint: AnchorPoint.BottomStart,
    minimumQueryLength: 0,
  }

  // Mock search functions for demo
  private searchArticles = async (query: string): Promise<SearchResult[]> => {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 500))

    const mockResults: SearchResult[] = [ /* eslint-disable @stylistic/max-len */
      { headline: 'Getting Started with React', id: '1', preview: 'Learn the basics of React development...', slug: 'getting-started-react' },
      { headline: 'Advanced TypeScript Patterns', id: '2', preview: 'Explore advanced TypeScript techniques...', slug: 'advanced-typescript' },
      { headline: 'CSS Grid Layout Guide', id: '3', preview: 'Master CSS Grid for modern layouts...', slug: 'css-grid-guide' },
      { headline: 'JavaScript Performance Tips', id: '4', preview: 'Optimize your JavaScript applications...', slug: 'js-performance' },
      { headline: 'Web Accessibility Best Practices', id: '5', preview: 'Make your web apps accessible to everyone...', slug: 'web-accessibility' },
    ] /* eslint-enable @stylistic/max-len */

    return mockResults.filter(result => query.length === 0
      || result.headline.toLowerCase().includes(query.toLowerCase())
      || result.preview.toLowerCase().includes(query.toLowerCase()))
  }

  private searchUsers = async (query: string): Promise<User[]> => {
    await new Promise(resolve => setTimeout(resolve, 300))

    const mockUsers: User[] = [
      { avatar: '👩', email: 'alice@example.com', id: '1', name: 'Alice Johnson' },
      { avatar: '👨', email: 'bob@example.com', id: '2', name: 'Bob Smith' },
      { avatar: '👩‍💼', email: 'carol@example.com', id: '3', name: 'Carol Davis' },
      { avatar: '👨‍💻', email: 'david@example.com', id: '4', name: 'David Wilson' },
      { avatar: '👩‍🎨', email: 'eva@example.com', id: '5', name: 'Eva Brown' },
    ]

    return mockUsers.filter(user => query.length === 0
      || user.name.toLowerCase().includes(query.toLowerCase())
      || user.email.toLowerCase().includes(query.toLowerCase()))
  }

  private searchSimple = async (query: string): Promise<string[]> => {
    await new Promise(resolve => setTimeout(resolve, 200))

    const fruits = ['apple', 'banana', 'cherry', 'date', 'elderberry', 'fig', 'grape', 'honeydew']
    return fruits.filter(fruit => query.length === 0
      || fruit.includes(query.toLowerCase()))
  }

  render(): React.ReactNode {
    return (
      <>
        <h1>AutoComplete</h1>
        <section>
          <p>
            AutoComplete is a generic component that combines TextEditor with PopupMenu to provide
            async search functionality with type-safe option handling. It supports any data type
            through TypeScript generics and provides a clean, accessible interface for search
            and selection operations.
          </p>
        </section>
        <section>
          <h2>Key Features</h2>
          <ul>
            <li><strong>Generic Type Support</strong>: Works with any data type through TypeScript generics</li>
            <li><strong>Async Search</strong>: Built-in support for async search operations with abort controllers</li>
            <li><strong>Debounced Input</strong>: Configurable debouncing to prevent excessive API calls</li>
            <li><strong>Keyboard Navigation</strong>: Full keyboard support with arrow keys, Enter, and Escape</li>
            <li><strong>Loading States</strong>: Built-in loading, error, and empty state handling</li>
            <li><strong>Flexible Rendering</strong>: Custom option rendering with sensible defaults</li>
            <li><strong>Accessibility Built-in</strong>: Proper ARIA attributes and semantic markup</li>
          </ul>
        </section>
        <section>
          <h2>Interactive Demo</h2>
          <div style={{ display: 'grid', gap: '2rem', gridTemplateColumns: '300px 1fr' }}>
            {/* Configuration Menu */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <strong>Anchor Point</strong>
                <select
                  value={this.state.anchorPoint}
                  onChange={e => this.setState({ anchorPoint: e.target.value as AnchorPoint })}
                >
                  <option value={AnchorPoint.Top}>Top</option>
                  <option value={AnchorPoint.TopStart}>Top Start</option>
                  <option value={AnchorPoint.TopEnd}>Top End</option>
                  <option value={AnchorPoint.Bottom}>Bottom</option>
                  <option value={AnchorPoint.BottomStart}>Bottom Start</option>
                  <option value={AnchorPoint.BottomEnd}>Bottom End</option>
                  <option value={AnchorPoint.Left}>Left</option>
                  <option value={AnchorPoint.Right}>Right</option>
                </select>
              </div>
              <div>
                <strong>Min Length</strong>
                <input
                  max="10"
                  min="0"
                  type="number"
                  value={this.state.minimumQueryLength}
                  onChange={e => this.setState({ minimumQueryLength: Number(e.target.value) })}
                />
              </div>
            </div>
            {/* Demo Area */}
            <div style={{ border: '1px solid #ccc', borderRadius: '4px', padding: '2rem' }}>
              <h3>Article Search</h3>
              <AutoComplete<SearchResult>
                anchorPoint={this.state.anchorPoint}
                getOptionValue={result => result.slug}
                minimumQueryLength={this.state.minimumQueryLength}
                placeholder="Search articles..."
                whenLoading="Searching articles..."
                whenNotFound="No articles found"
                getOptionLabel={result => (
                  <div>
                    <div style={{ fontWeight: 'bold' }}>{result.headline}</div>
                    <div style={{ color: '#666', fontSize: '0.9em' }}>{result.preview}</div>
                  </div>
                )}
                onSearch={this.searchArticles}
              />
              <h3>User Search</h3>
              <AutoComplete<User>
                anchorPoint={this.state.anchorPoint}
                getOptionValue={user => user.id}
                minimumQueryLength={this.state.minimumQueryLength}
                placeholder="Search users..."
                whenLoading="Searching users..."
                whenNotFound="No users found"
                getOptionLabel={user => (
                  <div style={{ alignItems: 'center', display: 'flex', gap: '0.5rem' }}>
                    <span>{user.avatar}</span>
                    <div>
                      <div>{user.name}</div>
                      <div style={{ color: '#666', fontSize: '0.9em' }}>{user.email}</div>
                    </div>
                  </div>
                )}
                onSearch={this.searchUsers}
              />
              <h3>Simple String Search</h3>
              <AutoComplete<string>
                anchorPoint={this.state.anchorPoint}
                getOptionLabel={fruit => fruit}
                getOptionValue={fruit => fruit}
                minimumQueryLength={this.state.minimumQueryLength}
                placeholder="Search fruits..."
                whenLoading="Searching fruits..."
                whenNotFound="No fruits found"
                onSearch={this.searchSimple}
              />
            </div>
          </div>
        </section>
        <section>
          <h2>Usage Examples</h2>
          <h3>Basic Article Search</h3>
          {Code.format(`
            interface SearchResult {
              headline: string,
              slug: string,
              preview: string,
            }

            <AutoComplete<SearchResult>
              onSearch={async (query) => {
                const response = await fetch(\`/api/search?q=\${query}\`)
                return response.json()
              }}
              getOptionValue={(result) => result.slug}
              getOptionLabel={(result) => (
                <div>
                  <div>{result.headline}</div>
                  <div>{result.preview}</div>
                </div>
              )}
              onSelect={(value, option) => {
                window.location.assign(\`/article/\${value}\`)
              }}
              placeholder="Search articles..."
            />
          `)}
          <h3>Simple String Array</h3>
          {Code.format(`
            <AutoComplete<string>
              onSearch={async (query) => {
                return ['apple', 'banana', 'cherry'].filter(fruit => 
                  fruit.includes(query.toLowerCase())
                )
              }}
              getOptionValue={(fruit) => fruit}
              getOptionLabel={(fruit) => fruit}
              onSelect={(value) => console.log('Selected:', value)}
            />
          `)}
          <h3>Complex Object with Custom Rendering</h3>
          {Code.format(`
            interface User {
              id: string
              name: string
              email: string
              avatar?: string
            }

            <AutoComplete<User>
              onSearch={async (query) => {
                const response = await fetch(\`/api/users/search?q=\${query}\`)
                return response.json()
              }}
              getOptionValue={(user) => user.id}
              getOptionLabel={(user) => (
                <div className="user-option">
                  <img src={user.avatar} alt="" />
                  <span>{user.name}</span>
                  <span>{user.email}</span>
                </div>
              )}
              getOptionKey={(user) => user.id}
              onSelect={(userId, user) => {
                console.log('Selected user:', user)
              }}
            />
          `)}
        </section>
        <section>
          <h2>Key Props</h2>
          <p>
            AutoComplete is generic over the option data type <code>T</code>, allowing you to work with
            any data structure while maintaining type safety. The component requires you to specify how
            to extract values and labels from your data through the required getter functions.
          </p>
          <h3>Required Props</h3>
          <ul>
            <li><strong>onSearch</strong>: Async function that returns options based on search query</li>
            <li><strong>getOptionValue</strong>: Function to extract the value from an option</li>
            <li><strong>getOptionLabel</strong>: Function to extract the display label from an option</li>
          </ul>
          <h3>Optional Props</h3>
          <ul>
            <li><strong>getOptionKey</strong>: Function to extract React key from an option (defaults to index)</li>
            <li><strong>getOptionDisabled</strong>: Function to determine if an option is disabled</li>
            <li><strong>optionRender</strong>: Custom render function for options (overrides getOptionLabel)</li>
            <li><strong>minLength</strong>: Minimum query length before triggering search (default: 0)</li>
            <li><strong>closeOnSelect</strong>: Whether to close dropdown on selection (default: true)</li>
            <li><strong>loadingContent</strong>: Content to show while loading</li>
            <li><strong>notFoundContent</strong>: Content to show when no results found</li>
          </ul>
          <h3>Popup Positioning</h3>
          <p>
            AutoComplete uses the Popup mixin for positioning, supporting all anchor points and
            positioning options. See the <Link to="/mixins">Mixins documentation</Link> for details.
          </p>
        </section>
        <section>
          <h2>Mixin System</h2>
          <p>
            AutoComplete uses the Component class's mixin system for enhanced functionality. For detailed
            information about each mixin, see the <Link to="/mixins">Mixins documentation</Link>.
          </p>
          {Code.format(`
            export class AutoComplete<T = unknown> extends Component<Props<T>, HTMLDivElement, State<T>> {
              static get mixins(): Set<Mixin> {
                return super.mixins
                  .add(Accessible)
                  .add(PrefixSuffix)
                  .add(Placeholder)
                  .add(Focusable)
                  .add(Popup)
              }
            }
          `)}
          <p>
            These mixins automatically provide accessibility features, auto-focus support, placeholder text,
            prefix/suffix content, and popup positioning. All mixins are automatically applied once declared.
          </p>
        </section>
        <section>
          <h2>Keyboard Navigation</h2>
          <p>
            AutoComplete provides full keyboard accessibility:
          </p>
          <ul>
            <li><strong>Arrow Down/Up</strong>: Navigate through options</li>
            <li><strong>Enter</strong>: Select the currently highlighted option</li>
            <li><strong>Escape</strong>: Close the dropdown</li>
            <li><strong>Tab</strong>: Move focus to the next focusable element</li>
          </ul>
          <p>
            The component automatically manages focus between the input and options, ensuring
            a smooth keyboard navigation experience.
          </p>
        </section>
        <section>
          <h2>Async Search and Performance</h2>
          <p>
            AutoComplete is designed for async operations with built-in performance optimizations:
          </p>
          <ul>
            <li><strong>Debouncing</strong>: Configurable debounce delay prevents excessive API calls</li>
            <li><strong>Abortable</strong>: Automatically cancels in-flight requests when new searches start</li>
            <li><strong>Loading States</strong>: Built-in loading indicators and error handling</li>
            <li><strong>Minimum Length</strong>: Configurable minimum query length to avoid unnecessary searches</li>
          </ul>
          <p>
            The component handles all the complexity of managing async state, allowing you to focus
            on your search logic and data transformation.
          </p>
        </section>
      </>
    )
  }
}
