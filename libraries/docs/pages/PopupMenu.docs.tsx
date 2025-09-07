import * as React from 'react'
import { AnchorPoint } from '@basis/react/types/AnchorPoint'
import { Button } from '../../react/components/Button/Button'
import { Menu } from '../../react/components/Menu/Menu'
import { PopupMenu } from '../../react/components/PopupMenu/PopupMenu'
import { Link } from '../../react/components/Router/Link'
import { Code } from '../components/Code'

interface State {
  anchorPoint: AnchorPoint,
  visible: boolean,
}

export class PopupMenuDocs extends React.Component<object, State> {
  state: State = {
    anchorPoint: AnchorPoint.Top,
    visible: true,
  }

  render(): React.ReactNode {
    return (
      <>
        <h1>PopupMenu</h1>
        <section>
          <p>
            PopupMenu is a positioned menu component that combines the Menu component with the Popup mixin
            for flexible positioning. It provides a menu that can be anchored to specific elements or positioned
            relative to its parent, with full Floating UI integration for robust positioning.
          </p>
          <h2>Key Features</h2>
          <ul>
            <li><strong>Menu Integration</strong>: Built on top of the Menu component with all its functionality</li>
            <li><strong>Flexible Positioning</strong>: Position relative to specific anchors or parent elements</li>
            <li><strong>Floating UI Integration</strong>: Robust positioning using Floating UI primitives</li>
            <li><strong>Smart Visibility</strong>: Control visibility with boolean or 'auto' modes</li>
            <li><strong>Accessibility Built-in</strong>: Proper ARIA roles and semantic markup</li>
          </ul>
        </section>
        <section>
          <h2>Interactive Demo</h2>
          <div style={{ display: 'grid', gap: '2rem', gridTemplateColumns: '300px 1fr' }}>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'space-between' }}>
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
                <h4>Visibility</h4>
                <select
                  value={this.state.visible.toString()}
                  onChange={e => this.setState({ visible: e.target.value === 'true' })}
                >
                  <option value="true">Visible</option>
                  <option value="false">Hidden</option>
                </select>
              </div>
            </div>
            {/* Demo Area */}
            <div style={{ border: '1px solid #ccc', borderRadius: '4px', padding: '2rem', textAlign: 'center' }}>
              <div style={{ display: 'inline-block', position: 'relative' }}>
                <Button>
                  Reference Element
                  <PopupMenu
                    anchorPoint={this.state.anchorPoint}
                    visible={this.state.visible}
                  >
                    <Menu.Item>Menu Item 1</Menu.Item>
                    <Menu.Item>Menu Item 2</Menu.Item>
                    <Menu.Divider />
                    <Menu.Item>Menu Item 3</Menu.Item>
                  </PopupMenu>
                </Button>
              </div>
            </div>
          </div>
        </section>
        <section>
          <h2>Usage Examples</h2>
          <h3>Basic PopupMenu (Parent-based)</h3>
          {Code.format(`
            <div className="container">
              <Button>Trigger</Button>
              <PopupMenu anchorPoint="top">
                <PopupMenu.Item onActivate={handleAction1}>
                  Action 1
                </PopupMenu.Item>
                <PopupMenu.Item onActivate={handleAction2}>
                  Action 2
                </PopupMenu.Item>
              </PopupMenu>
            </div>
          `)}
          <h3>Anchor-based PopupMenu</h3>
          {Code.format(`
            const anchorRef = React.createRef<HTMLDivElement>()
            
            <div>
              <div ref={anchorRef}>Anchor Element</div>
              <PopupMenu 
                anchorTo={anchorRef} 
                anchorPoint="bottom-end"
                arrow={true}
                offset={8}
              >
                <PopupMenu.Item onActivate={handleAction}>
                  Anchored Action
                </PopupMenu.Item>
              </PopupMenu>
            </div>
          `)}
          <h3>Controlled Visibility</h3>
          {Code.format(`
            <PopupMenu visible={isVisible} anchorPoint="right">
              <PopupMenu.Item onActivate={handleAction}>
                Controlled Menu Item
              </PopupMenu.Item>
            </PopupMenu>
          `)}
        </section>
        <section>
          <h2>Key Props</h2>
          <p>
            PopupMenu extends both the Menu component and the IPopup interface, providing all menu functionality
            with flexible positioning capabilities. The <code>anchorPoint</code> prop controls positioning relative
            to the reference element, while <code>anchorTo</code> allows you to target specific elements instead
            of the default parent-based positioning.
          </p>
          <p>
            The <code>visible</code> prop accepts boolean values or 'auto' for automatic visibility management.
            When set to 'auto', the menu will show/hide based on hover state or other interaction patterns.
          </p>
        </section>
        <section>
          <h2>Mixin System</h2>
          <p>
            PopupMenu uses the Component class's mixin system for enhanced functionality. For detailed
            information about each mixin, see the <Link to="/mixins">Mixins documentation</Link>.
          </p>
          {Code.format(`
            export class PopupMenu extends Component<Props, HTMLUListElement> {
              static get mixins(): Set<Mixin> {
                return super.mixins.add(Popup)
              }
            }
          `)}
          <p>
            The Popup mixin automatically provides positioning support using Floating UI primitives,
            handling both anchor-based and parent-based positioning with automatic repositioning on updates.
          </p>
        </section>
        <section>
          <h2>Positioning and Anchor Points</h2>
          <p>
            PopupMenu uses the Popup mixin for flexible positioning. For detailed information about
            available anchor points and positioning options, see the <Link to="/mixins">Mixins documentation</Link>.
          </p>
          <p>
            The Popup mixin provides 12 anchor point options that directly map to Floating UI placement values,
            supporting both anchor-based and parent-based positioning with automatic repositioning.
          </p>
        </section>
        <section>
          <h2>Menu Items and Structure</h2>
          <p>
            PopupMenu inherits all menu functionality from the Menu component, including:
          </p>
          <ul>
            <li><strong>Menu.Item</strong>: Individual menu options with activation handlers</li>
            <li><strong>Menu.Divider</strong>: Visual separation between menu groups</li>
            <li><strong>Keyboard Navigation</strong>: Full arrow key navigation support</li>
            <li><strong>Disabled State</strong>: Support for disabled menu items</li>
          </ul>
          <p>
            All menu items support the <code>onActivate</code> prop for handling user interactions,
            and the <code>disabled</code> prop for disabling individual items.
          </p>
        </section>
      </>
    )
  }
}
