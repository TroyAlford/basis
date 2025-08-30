import * as React from 'react'
import { Button } from '../../react/components/Button/Button'
import { DropdownMenu } from '../../react/components/DropdownMenu/DropdownMenu'
import { Link } from '../../react/components/Router/Link'
import { Code } from '../components/Code'

interface State {
  direction: DropdownMenu['props']['direction'],
  offset: number,
  open: boolean,
}

export class DropdownMenuDocs extends React.Component<object, State> {
  state: State = {
    direction: DropdownMenu.Direction.S,
    offset: 8,
    open: false,
  }

  render = (): React.ReactNode => (
    <>
      <h1>DropdownMenu</h1>
      <section>
        <p>
          DropdownMenu is a composite component that combines a trigger button with a popup menu.
          It provides a clean, accessible way to present additional options or actions without
          cluttering the main interface.
        </p>
      </section>
      <section>
        <h2>Key Features</h2>
        <ul>
          <li><strong>Composite Design</strong>: Combines Button and Menu components seamlessly</li>
          <li><strong>Flexible Trigger</strong>: Customizable trigger content and styling</li>
          <li><strong>Smart Positioning</strong>: Automatic directional positioning with offset control</li>
          <li><strong>Keyboard Navigation</strong>: Full keyboard support for accessibility</li>
          <li><strong>State Management</strong>: Built-in open/close state with callbacks</li>
          <li><strong>Accessibility Built-in</strong>: Proper ARIA attributes and semantic markup</li>
        </ul>
      </section>
      <section>
        <h2>Interactive Demo</h2>
        <div style={{ display: 'grid', gap: '2rem', gridTemplateColumns: '300px 1fr' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <h4>Direction</h4>
              <select
                defaultValue="S"
                style={{ padding: '0.5rem', width: '100%' }}
                onChange={e => this.setState({ direction: e.target.value as DropdownMenu['props']['direction'] })}
              >
                <option value="N">North</option>
                <option value="NE">North East</option>
                <option value="E">East</option>
                <option value="SE">South East</option>
                <option value="S">South (default)</option>
                <option value="SW">South West</option>
                <option value="W">West</option>
                <option value="NW">North West</option>
              </select>
            </div>
            <div>
              <h4>Offset</h4>
              <input
                defaultValue="8"
                max="32"
                min="0"
                step="4"
                style={{ width: '100%' }}
                type="range"
                onChange={e => this.setState({ offset: Number(e.target.value) })}
              />
              <span>{this.state.offset}px</span>
            </div>
            <div>
              <h4>State</h4>
              <Button onActivate={() => this.setState({ open: !this.state.open })}>
                {this.state.open ? 'Close' : 'Open'} Menu
              </Button>
            </div>
          </div>
          {/* Demo Area */}
          <div style={{ border: '1px solid #ccc', borderRadius: '4px', padding: '2rem', textAlign: 'center' }}>
            <div style={{ display: 'inline-block', position: 'relative' }}>
              <DropdownMenu
                direction={this.state.direction}
                offset={this.state.offset}
                open={this.state.open}
                trigger="Click to Open"
                onClose={() => this.setState({ open: false })}
                onOpen={() => this.setState({ open: true })}
              >
                <DropdownMenu.Item>View Profile</DropdownMenu.Item>
                <DropdownMenu.Item>Settings</DropdownMenu.Item>
                <DropdownMenu.Divider />
                <DropdownMenu.Item>Logout</DropdownMenu.Item>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </section>
      <section>
        <h2>Usage Examples</h2>
        <h3>Basic Dropdown</h3>
        {Code.format(`
            <DropdownMenu trigger="Options">
              <DropdownMenu.Item onActivate={handleEdit}>
                Edit
              </DropdownMenu.Item>
              <DropdownMenu.Item onActivate={handleDelete}>
                Delete
              </DropdownMenu.Item>
            </DropdownMenu>
          `)}
        <h3>With Custom Trigger</h3>
        {Code.format(`
            <DropdownMenu trigger={<Button>Custom Button</Button>}>
              <DropdownMenu.Item onActivate={handleAction1}>
                Action 1
              </DropdownMenu.Item>
              <DropdownMenu.Item onActivate={handleAction2}>
                Action 2
              </DropdownMenu.Item>
            </DropdownMenu>
          `)}
        <h3>Controlled State</h3>
        {Code.format(`
            <DropdownMenu
              open={isOpen}
              onOpen={() => setIsOpen(true)}
              onClose={() => setIsOpen(false)}
              trigger="Controlled Menu"
            >
              <DropdownMenu.Item onActivate={handleAction}>
                Controlled Action
              </DropdownMenu.Item>
            </DropdownMenu>
          `)}
      </section>
      <section>
        <h2>Key Props</h2>
        <p>
          DropdownMenu manages its own open/close state by default, but you can control it manually
          with the <code>open</code> prop and <code>onOpen</code>/<code>onClose</code> callbacks.
        </p>
        <p>
          The <code>trigger</code> prop accepts any React content to display as the clickable button,
          while <code>direction</code> and <code>offset</code> control the menu positioning relative
          to the trigger.
        </p>
      </section>
      <section>
        <h2>Mixin System</h2>
        <p>
          DropdownMenu uses the Component class's mixin system for enhanced functionality. For detailed
          information about each mixin, see the <Link to="/mixins">Mixins documentation</Link>.
        </p>
        {Code.format(`
            export class DropdownMenu extends Component<Props, HTMLDivElement, State> {
              static get mixins(): Set<Mixin> {
                return super.mixins.add(Directional)
              }
            }
          `)}
        <p>
          The Directional mixin automatically provides positioning support, ensuring the dropdown menu
          appears in the correct location relative to the trigger button.
        </p>
      </section>
      <section>
        <h2>Menu Items and Structure</h2>
        <h3>Item Component</h3>
        <p>
          <code>DropdownMenu.Item</code> renders individual menu options with proper semantic markup
          and keyboard navigation support:
        </p>
        {Code.format(`
            <DropdownMenu.Item onActivate={handleAction}>
              Menu Item Text
            </DropdownMenu.Item>
          `)}
        <h3>Divider Component</h3>
        <p>
          <code>DropdownMenu.Divider</code> creates visual separation between groups of menu items:
        </p>
        {Code.format(`
            <DropdownMenu.Item>First Group</DropdownMenu.Item>
            <DropdownMenu.Divider />
            <DropdownMenu.Item>Second Group</DropdownMenu.Item>
          `)}
        <h3>Disabled State</h3>
        <p>
          Menu items can be disabled by setting the <code>disabled</code> prop:
        </p>
        {Code.format(`
            <DropdownMenu.Item disabled onActivate={handleAction}>
              Disabled Action
            </DropdownMenu.Item>
          `)}
      </section>
      <section>
        <h2>Keyboard Navigation</h2>
        <p>
          DropdownMenu provides full keyboard accessibility:
        </p>
        <ul>
          <li><strong>Enter/Space</strong>: Activates the focused menu item</li>
          <li><strong>Arrow Keys</strong>: Navigate between menu items</li>
          <li><strong>Escape</strong>: Closes the dropdown menu</li>
          <li><strong>Tab</strong>: Moves focus to the next focusable element</li>
        </ul>
        <p>
          When opened, focus automatically moves to the first menu item, and the menu
          can be navigated entirely with the keyboard.
        </p>
      </section>
      <section>
        <h2>Positioning and Directions</h2>
        <p>
          Like Tooltip, DropdownMenu supports 8 cardinal directions for flexible positioning.
          The menu automatically appears in the specified direction relative to the trigger button,
          with configurable offset for fine-tuning the placement.
        </p>
        <p>
          The default South direction works well for most use cases, but you can customize
          based on available screen space and design requirements.
        </p>
      </section>

    </>
  )
}
