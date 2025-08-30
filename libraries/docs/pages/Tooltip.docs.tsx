import * as React from 'react'
import { Button } from '../../react/components/Button/Button'
import { Link } from '../../react/components/Router/Link'
import { Tooltip } from '../../react/components/Tooltip/Tooltip'
import { Code } from '../components/Code'

interface State {
  direction: Tooltip['props']['direction'],
  offset: number,
  visible: Tooltip['props']['visible'],
}

export class TooltipDocs extends React.Component<object, State> {
  state: State = {
    direction: Tooltip.Direction.S,
    offset: 8,
    visible: Tooltip.defaultProps.visible,
  }

  render(): React.ReactNode {
    return (
      <>
        <h1>Tooltip</h1>
        <section>
          <p>
            Tooltip is a contextual information bubble that automatically anchors to its nearest parent element.
            It provides helpful descriptions, hints, or additional context without cluttering the main interface.
          </p>
        </section>
        <section>
          <h2>Key Features</h2>
          <ul>
            <li><strong>Automatic Positioning</strong>: Anchors to the nearest parent element automatically</li>
            <li><strong>Directional Control</strong>: Configurable positioning with 8 cardinal directions</li>
            <li><strong>Smart Visibility</strong>: Auto-hide/show based on hover state or manual control</li>
            <li><strong>Customizable Animation</strong>: Configurable animation duration and timing</li>
            <li><strong>Accessibility Built-in</strong>: Proper ARIA roles and semantic markup</li>
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
                  onChange={e => this.setState({ direction: e.target.value as State['direction'] })}
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
                <h4>Visibility</h4>
                <select
                  defaultValue="auto"
                  style={{ padding: '0.5rem', width: '100%' }}
                  onChange={e => this.setState({ visible: e.target.value as State['visible'] })}
                >
                  <option value="auto">Auto (hover-based)</option>
                  <option value="true">Always Visible</option>
                  <option value="false">Always Hidden</option>
                </select>
              </div>
            </div>
            {/* Demo Area */}
            <div style={{ border: '1px solid #ccc', borderRadius: '4px', padding: '2rem', textAlign: 'center' }}>
              <div style={{ display: 'inline-block', position: 'relative' }}>
                <Button>Hover Me</Button>
                <Tooltip
                  animationDuration="0.2s"
                  direction={this.state.direction}
                  offset={this.state.offset}
                  visible={this.state.visible}
                >
                  This tooltip shows contextual information about the button above!
                </Tooltip>
              </div>
            </div>
          </div>
        </section>
        <section>
          <h2>Usage Examples</h2>
          <h3>Basic Tooltip</h3>
          {Code.format(`
            <Button>
              Submit Form
              <Tooltip>Click to submit your form data</Tooltip>
            </Button>
          `)}
          <h3>Custom Direction and Offset</h3>
          {Code.format(`
            <TextEditor field="username" placeholder="Enter username" />
            <Tooltip direction="NE" offset={12}>
              Username must be at least 3 characters long
            </Tooltip>
          `)}
          <h3>Manual Visibility Control</h3>
          {Code.format(`
            <Tooltip visible={isVisible} animationDuration="0.3s">
              This tooltip is manually controlled
            </Tooltip>
          `)}
        </section>
        <section>
          <h2>Key Props</h2>
          <p>
            Tooltip automatically handles positioning and visibility, but you can customize its behavior
            with direction, offset, and animation settings.
          </p>
          <p>
            The <code>direction</code> prop controls which side of the parent element the tooltip appears on,
            while <code>offset</code> determines the distance from the parent. The <code>visible</code> prop
            allows manual control over when the tooltip is shown.
          </p>
        </section>
        <section>
          <h2>Mixin System</h2>
          <p>
            Tooltip uses the Component class's mixin system for enhanced functionality. For detailed
            information about each mixin, see the <Link to="/mixins">Mixins documentation</Link>.
          </p>
          {Code.format(`
            export class Tooltip extends Component<Props, HTMLDivElement> {
              static get mixins(): Set<Mixin> {
                return super.mixins.add(Directional)
              }
            }
          `)}
          <p>
            The Directional mixin automatically provides positioning support, setting the appropriate
            CSS variables and data attributes for proper tooltip placement.
          </p>
        </section>
        <section>
          <h2>Positioning and Directions</h2>
          <h3>Cardinal Directions</h3>
          <p>
            Tooltip supports 8 cardinal directions for flexible positioning:
          </p>
          <ul>
            <li><strong>N (North)</strong>: Appears above the parent element</li>
            <li><strong>NE (North East)</strong>: Appears above and to the right</li>
            <li><strong>E (East)</strong>: Appears to the right of the parent</li>
            <li><strong>SE (South East)</strong>: Appears below and to the right</li>
            <li><strong>S (South)</strong>: Appears below the parent (default)</li>
            <li><strong>SW (South West)</strong>: Appears below and to the left</li>
            <li><strong>W (West)</strong>: Appears to the left of the parent</li>
            <li><strong>NW (North West)</strong>: Appears above and to the left</li>
          </ul>
          <h3>Automatic Anchoring</h3>
          <p>
            Tooltip automatically anchors to its nearest positioned parent element. Place it as a direct
            child of the element you want to describe, and it will position itself accordingly.
          </p>
        </section>
        <section>
          <h2>Animation and Timing</h2>
          <p>
            Tooltip includes smooth animations for showing and hiding.
            The <code>animationDuration</code> prop accepts both numbers (interpreted as seconds) and CSS time strings:
          </p>
          <ul>
            <li><code>animationDuration={0.2}</code> → 0.2 seconds</li>
            <li><code>animationDuration="300ms"</code> → 300 milliseconds</li>
            <li><code>animationDuration=".5s"</code> → 0.5 seconds</li>
          </ul>
        </section>

      </>
    )
  }
}
