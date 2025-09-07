import * as React from 'react'
import { AnchorPoint } from '@basis/react/types/AnchorPoint'
import { Button } from '../../react/components/Button/Button'
import { DropdownMenu } from '../../react/components/DropdownMenu/DropdownMenu'
import { Link } from '../../react/components/Router/Link'
import { Code } from '../components/Code'

interface State {
  anchorPoint: AnchorPoint,
  open: boolean,
}

export class DropdownMenuDocs extends React.Component<object, State> {
  state: State = {
    anchorPoint: AnchorPoint.Top,
    open: true,
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
              <h4>Anchor Point</h4>
              <select
                defaultValue={AnchorPoint.Top}
                onChange={e => this.setState({ anchorPoint: e.target.value as AnchorPoint })}
              >
                <option value={AnchorPoint.Top}>Top</option>
                <option value={AnchorPoint.TopStart}>Top Start</option>
                <option value={AnchorPoint.TopEnd}>Top End</option>
                <option value={AnchorPoint.Bottom}>Bottom</option>
                <option value={AnchorPoint.BottomStart}>Bottom Start</option>
                <option value={AnchorPoint.BottomEnd}>Bottom End</option>
                <option value={AnchorPoint.Left}>Left</option>
                <option value={AnchorPoint.LeftStart}>Left Start</option>
                <option value={AnchorPoint.LeftEnd}>Left End</option>
                <option value={AnchorPoint.Right}>Right</option>
                <option value={AnchorPoint.RightStart}>Right Start</option>
                <option value={AnchorPoint.RightEnd}>Right End</option>
              </select>
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
                anchorPoint={this.state.anchorPoint}
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
          The <code>trigger</code> prop accepts any React content to display as the clickable button.
          DropdownMenu now uses the Popup mixin for positioning,
          supporting <code>anchorPoint</code>, <code>arrow</code>, and <code>offset</code> props
          for flexible positioning relative to the trigger.
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
                return super.mixins.add(Popup)
              }
            }
          `)}
        <p>
          The Popup mixin automatically provides positioning support using Floating UI primitives,
          ensuring the dropdown menu appears in the correct location relative to the trigger button
          with support for all anchor points and automatic repositioning.
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
        <h2>Positioning and Anchor Points</h2>
        <p>
          DropdownMenu uses the Popup mixin for flexible positioning. For detailed information about
          available anchor points and positioning options, see the <Link to="/mixins">Mixins documentation</Link>.
        </p>
        <p>
          The <code>anchorPoint</code> prop controls positioning, while <code>offset</code> allows fine-tuning
          the distance between the trigger and menu. The <code>arrow</code> prop can add a visual pointer
          connecting the menu to its trigger.
        </p>
      </section>

    </>
  )
}
