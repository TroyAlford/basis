import * as React from 'react'
import { Menu } from '../../react/components/Menu/Menu'
import { Code } from '../components/Code'

interface State {
  disabled: boolean,
  orientation: Menu['props']['orientation'],
}

export class MenuDocs extends React.Component<object, State> {
  state: State = {
    disabled: false,
    orientation: Menu.Orientation.Vertical,
  }

  render(): React.ReactNode {
    return (
      <>
        <h1>Menu</h1>
        <section>
          <p>
            Menu is a foundational component that provides menu structure and keyboard navigation.
            It's designed to be used either as a standalone inline menu or as the foundation for
            more complex components like DropdownMenu.
          </p>
        </section>
        <section>
          <h2>Key Features</h2>
          <ul>
            <li>
              <strong>Semantic Structure</strong>:
              Proper HTML semantics with <code>ul</code> and <code>li</code> elements
            </li>
            <li><strong>Keyboard Navigation</strong>: Full arrow key navigation between menu items</li>
            <li><strong>Orientation Support</strong>: Both vertical and horizontal menu layouts</li>
            <li><strong>Accessibility Built-in</strong>: Proper ARIA roles and keyboard event handling</li>
            <li><strong>Flexible Content</strong>: Menu items can contain any React content</li>
            <li><strong>Disabled State</strong>: Support for disabled menu items and entire menus</li>
          </ul>
        </section>
        <section>
          <h2>Interactive Demo</h2>
          <div style={{ display: 'grid', gap: '2rem', gridTemplateColumns: '300px 1fr' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <h4>Orientation</h4>
                <select
                  defaultValue={Menu.Orientation.Vertical}
                  style={{ padding: '0.5rem', width: '100%' }}
                  onChange={e => this.setState({ orientation: e.target.value as Menu['props']['orientation'] })}
                >
                  <option value={Menu.Orientation.Vertical}>Vertical (default)</option>
                  <option value={Menu.Orientation.Horizontal}>Horizontal</option>
                </select>
              </div>
              <div>
                <h4>Disabled State</h4>
                <label style={{ alignItems: 'center', display: 'flex', gap: '0.5rem' }}>
                  <input
                    checked={this.state.disabled}
                    type="checkbox"
                    onChange={e => this.setState({ disabled: e.target.checked })}
                  /> Disable Menu
                </label>
              </div>
            </div>
            {/* Demo Area */}
            <div style={{ border: '1px solid #ccc', borderRadius: '4px', padding: '2rem' }}>
              <div style={{ display: 'flex', gap: '2rem', justifyContent: 'center' }}>
                <div>
                  <Menu
                    disabled={this.state.disabled}
                    orientation={this.state.orientation}
                  >
                    <Menu.Item>Profile</Menu.Item>
                    <Menu.Item>Settings</Menu.Item>
                    <Menu.Divider />
                    <Menu.Item>Help</Menu.Item>
                  </Menu>
                </div>
              </div>
            </div>
          </div>
        </section>
        <section>
          <h2>Usage Examples</h2>
          <h3>Basic Vertical Menu</h3>
          {Code.format(`
            <Menu>
              <Menu.Item onActivate={handleProfile}>
                View Profile
              </Menu.Item>
              <Menu.Item onActivate={handleSettings}>
                Settings
              </Menu.Item>
              <Menu.Item onActivate={handleLogout}>
                Logout
              </Menu.Item>
            </Menu>
          `)}
          <h3>Horizontal Navigation Menu</h3>
          {Code.format(`
            <Menu orientation={Menu.Orientation.Horizontal}>
              <Menu.Item onActivate={() => navigate('/')}>
                Home
              </Menu.Item>
              <Menu.Item onActivate={() => navigate('/about')}>
                About
              </Menu.Item>
              <Menu.Item onActivate={() => navigate('/contact')}>
                Contact
              </Menu.Item>
            </Menu>
          `)}
          <h3>With Dividers and Disabled Items</h3>
          {Code.format(`
            <Menu>
              <Menu.Item onActivate={handleEdit}>
                Edit
              </Menu.Item>
              <Menu.Item onActivate={handleCopy}>
                Copy
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item disabled onActivate={handleDelete}>
                Delete (Disabled)
              </Menu.Item>
            </Menu>
          `)}
        </section>
        <section>
          <h2>Key Props</h2>
          <p>
            Menu is designed to be simple and focused. The <code>orientation</code> prop controls
            whether items are laid out vertically or horizontally, while <code>disabled</code> allows
            you to disable the entire menu and all its items.
          </p>
          <p>
            Menu items are created using the static <code>Menu.Item</code> component, which provides
            proper semantic markup and keyboard event handling for each individual option.
          </p>
        </section>
        <section>
          <h2>Menu Items and Structure</h2>
          <h3>Item Component</h3>
          <p>
            <code>Menu.Item</code> renders individual menu options with proper semantic markup:
          </p>
          {Code.format(`
            <Menu.Item onActivate={handleAction}>
              Menu Item Text
            </Menu.Item>
          `)}
          <p>
            Each item supports an <code>onActivate</code> callback that fires when the item is
            clicked or activated via keyboard (Enter/Space).
          </p>
          <h3>Divider Component</h3>
          <p>
            <code>Menu.Divider</code> creates visual separation between groups of menu items:
          </p>
          {Code.format(`
            <Menu.Item>First Group</Menu.Item>
            <Menu.Divider />
            <Menu.Item>Second Group</Menu.Item>
          `)}
          <h3>Disabled State</h3>
          <p>
            Individual menu items can be disabled:
          </p>
          {Code.format(`
            <Menu.Item disabled onActivate={handleAction}>
              Disabled Action
            </Menu.Item>
          `)}
        </section>
        <section>
          <h2>Keyboard Navigation</h2>
          <p>
            Menu provides comprehensive keyboard accessibility:
          </p>
          <ul>
            <li><strong>Arrow Keys</strong>: Navigate between menu items based on orientation</li>
            <li><strong>Enter/Space</strong>: Activates the focused menu item</li>
            <li><strong>Tab</strong>: Moves focus to the next focusable element</li>
            <li><strong>Focus Management</strong>: Proper focus handling for disabled items</li>
          </ul>
          <h3>Orientation-Specific Navigation</h3>
          <p>
            Navigation adapts to the menu orientation:
          </p>
          <ul>
            <li><strong>Vertical</strong>: Up/Down arrows navigate between items</li>
            <li><strong>Horizontal</strong>: Left/Right arrows navigate between items</li>
          </ul>
        </section>
        <section>
          <h2>Semantic HTML</h2>
          <p>Menu renders with proper semantic HTML structure:</p>
          {Code.format(`
            <ul role="menu" data-orientation="vertical">
              <li role="menuitem" tabIndex="0">Menu Item 1</li>
              <li role="menuitem" tabIndex="0">Menu Item 2</li>
              <hr role="separator" />
              <li role="menuitem" tabIndex="0">Menu Item 3</li>
            </ul>
          `)}
          <p>
            This semantic structure ensures proper accessibility and allows screen readers
            to understand the menu hierarchy and navigation.
          </p>
        </section>
        <section>
          <h2>Integration with Other Components</h2>
          <p>Menu is designed to work seamlessly with other components:</p>
          <h3>DropdownMenu Integration</h3>
          <p>
            Menu serves as the foundation for DropdownMenu, providing the menu structure
            while DropdownMenu handles the popup behavior and positioning.
          </p>
          <h3>Custom Menu Systems</h3>
          <p>
            You can build custom menu systems by combining Menu with other components
            or implementing custom positioning and state management.
          </p>
        </section>

      </>
    )
  }
}
