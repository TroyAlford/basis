import { AnchorPoint } from '@basis/react'
import { Button } from '../../react/components/Button/Button'
import { Link } from '../../react/components/Router/Link'
import { Tooltip } from '../../react/components/Tooltip/Tooltip'
import { Code } from '../components/Code'
import { Documentation } from '../components/Documentation'

interface State {
  anchorPoint: AnchorPoint,
  visible: Tooltip['props']['visible'],
}

export class TooltipDocs extends Documentation<State> {
  static override defaultProps = {
    ...Documentation.defaultProps,
    initialValue: {
      anchorPoint: AnchorPoint.Top,
      visible: true as Tooltip['props']['visible'],
    },
  }

  content() {
    return (
      <>
        <h1>Tooltip</h1>
        <section>
          <p>
            A <code>Tooltip</code> is a contextual information bubble shown next to an anchor element or its parent.
            It provides helpful descriptions, hints, or additional context without cluttering the main interface.
          </p>
          <h2>Key Features</h2>
          <ul>
            <li><strong>Flexible Positioning</strong>: Position relative to specific anchors or parent elements</li>
            <li><strong>Floating UI Integration</strong>: Robust positioning using Floating UI primitives</li>
            <li><strong>Smart Visibility</strong>: Auto-hide/show based on hover state or manual control</li>
            <li><strong>Customizable Animation</strong>: Configurable animation duration and timing</li>
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
                  onChange={e => void this.handleField(e.target.value as AnchorPoint, 'anchorPoint')}
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
                  value={String(this.current.visible)}
                  onChange={e => {
                    const raw = e.target.value
                    const visible = raw === 'auto'
                      ? 'auto'
                      : raw === 'true'
                    void this.handleField(visible as Tooltip['props']['visible'], 'visible')
                  }}
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
                <Button>
                  Hover Me
                  <Tooltip anchorPoint={this.current.anchorPoint} visible={this.current.visible}>
                    This tooltip shows contextual information about the button above!
                  </Tooltip>
                </Button>
              </div>
            </div>
          </div>
        </section>
        <section>
          <h2>Usage Examples</h2>
          <h3>Basic Tooltip (Parent-based)</h3>
          {Code.format(`
            <Button>
              Submit Form
              <Tooltip anchorPoint="top">
                Click to submit your form data
              </Tooltip>
            </Button>
          `)}
          <h3>Anchor-based Tooltip</h3>
          {Code.format(`
            const anchorRef = React.createRef<HTMLDivElement>()
            
            <div>
              <div ref={anchorRef}>Username field</div>
              <Tooltip 
                anchorTo={anchorRef} 
                anchorPoint="bottom-end"
              >
                Username must be at least 3 characters long
              </Tooltip>
            </div>
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
            Tooltip uses the new Popup mixin for flexible positioning. The <code>anchorPoint</code> prop controls
            positioning relative to the reference element, while <code>anchorTo</code> allows you to target specific
            elements instead of the default parent-based positioning.
          </p>
          <p>
            The <code>anchorPoint</code> prop directly maps to Floating UI placement values, providing precise
            control over tooltip positioning with options like "top", "bottom-start", "left-end", etc.
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
            Tooltip uses the Popup mixin for flexible positioning. For detailed information about
            available anchor points and positioning options, see the <Link to="/mixins">Mixins documentation</Link>.
          </p>
          <p>
            The Popup mixin provides 12 anchor point options that directly map to Floating UI placement values,
            supporting both anchor-based and parent-based positioning with automatic repositioning.
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
