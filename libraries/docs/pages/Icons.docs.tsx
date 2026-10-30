import type { IconProps } from 'basis/react'
import { Button, css, EnumEditor, NumberEditor, style, TextEditor } from 'basis/react'
import * as Icons from 'basis/react/icons'
import type { ComponentType, CSSProperties, ReactNode } from 'react'
import { IconBase } from '../../react/icons/IconBase/IconBase'
import { Code } from '../components/Code'
import { DocumentationPage } from '../components/DocumentationPage'

import './Icons.styles.ts'

interface State {
  color: string,
  filled: boolean,
  filterText: string,
  iconColor: string,
  iconFilled: boolean,
  moonColor: string,
  moonDay: number,
  moonFilled: boolean,
  moonPeriod: number,
  moonSecondary: string,
  moonTilt: number,
  overlayColor: string,
  overlayFilled: boolean,
  overlayIcon: string,
  overlaySize: number,
  primaryIcon: string,
  showNames: boolean,
  size: number,
}

export class IconsDocs extends DocumentationPage<State> {
  static override defaultProps = {
    ...DocumentationPage.defaultProps,
    initialValue: {
      color: '',
      filled: false,
      filterText: '',
      iconColor: '',
      iconFilled: false,
      moonColor: '#336699',
      moonDay: 3.5,
      moonFilled: true,
      moonPeriod: 28,
      moonSecondary: '#11111144',
      moonTilt: 28.5,
      overlayColor: '#66aa66',
      overlayFilled: false,
      overlayIcon: 'Plus',
      overlaySize: 192,
      primaryIcon: 'Lightning',
      showNames: true,
      size: 60,
    },
  }

  // Get all icon components (excluding Icon, IconBase, and utility components)
  get iconComponents() {
    return Object.entries(Icons as unknown as Record<string, ComponentType<IconProps>>)
      .filter(([name]) => typeof Icons[name] === 'function')
      .filter(([name]) => {
        if (this.current.filterText) {
          return name.toLowerCase().includes(this.current.filterText.toLowerCase())
        }
        return true
      })
      .sort(([a], [b]) => a.localeCompare(b))
  }

  renderIconGrid = () => {
    const { filled, showNames } = this.current

    return (
      <div className="icon-grid">
        {this.iconComponents.map(([name, IconComponent]) => (
          <div
            key={name}
            className="icon-item"
          >
            <div className="icon-demo-container">
              <IconComponent filled={filled} />
            </div>
            {showNames && (
              <span className="icon-name">
                {name}
              </span>
            )}
          </div>
        ))}
      </div>
    )
  }

  get overlayableIconEnum(): Record<string, string> {
    return Object.fromEntries(
      Object.entries(Icons)
        .filter(([, ctor]) => IconBase.isIcon(ctor))
        .map(([name]) => [name, name])
        .sort(([a], [b]) => a.localeCompare(b)),
    )
  }

  renderOverlayDemo = (): ReactNode => {
    const { iconFilled, overlayFilled, overlayIcon, primaryIcon } = this.current
    const icons = Icons as unknown as Record<string, ComponentType<IconProps>>
    const Main = icons[primaryIcon]
    const Overlay = icons[overlayIcon]
    if (!Main || !Overlay) return null

    if (overlayFilled === iconFilled) {
      return <Main filled={iconFilled} overlay={Overlay as unknown as typeof IconBase} />
    }

    return <Main filled={iconFilled} overlay={<Overlay filled={overlayFilled} />} />
  }

  renderSpecialIcons = () => (
    <div className="special-icons-grid">
      {/* Triangle Component */}
      <div className="special-icon-item">
        <div className="icon-demo-container">
          <Icons.Triangle orientation={Icons.Triangle.Orientation.Right} />
        </div>
        <span className="special-icon-name">Triangle (Right)</span>
      </div>
      {/* Sort Component */}
      <div className="special-icon-item">
        <div className="icon-demo-container">
          <Icons.Sort
            direction={Icons.Sort.Direction.Asc}
            sortBy={Icons.Sort.By.Name}
          />
        </div>
        <span className="special-icon-name">Sort (by name)</span>
      </div>
      {/* Grip Component */}
      <div className="special-icon-item">
        <div className="icon-demo-container">
          <Icons.Grip orientation={Icons.Grip.Orientation.Horizontal} />
        </div>
        <span className="special-icon-name">Grip (Horizontal)</span>
      </div>
      {/* Zoom Component */}
      <div className="special-icon-item">
        <div className="icon-demo-container">
          <Icons.Zoom direction={Icons.Zoom.Direction.In} />
        </div>
        <span className="special-icon-name">Zoom (In)</span>
      </div>
    </div>
  )

  renderMoonPhaseSection = () => {
    const { moonColor, moonDay, moonFilled, moonPeriod, moonSecondary, moonTilt } = this.current

    return (
      <div className="moon-phase-section">
        <div className="moon-controls">
          <h3>Moon Phase Controls</h3>
          <div className="moon-controls-grid">
            <div className="control-group">
              <label>Primary Color</label>
              <input
                className="color-input"
                type="color"
                value={moonColor}
                onChange={event => void this.handleField(event.target.value, 'moonColor')}
              />
            </div>
            <div className="control-group">
              <label>Secondary Color</label>
              <input
                className="color-input"
                type="color"
                value={moonSecondary}
                onChange={event => void this.handleField(event.target.value, 'moonSecondary')}
              />
            </div>
            <div className="control-group">
              <label>Filled</label>
              <Button
                className={moonFilled ? 'primary' : 'secondary'}
                onActivate={() => void this.handleField(!moonFilled, 'moonFilled')}
              >
                {moonFilled ? 'Filled' : 'Outline'}
              </Button>
            </div>
            <div className="control-group">
              <label>Moon Day: {moonDay}</label>
              <NumberEditor
                value={moonDay}
                onChange={value => void this.handleField(value, 'moonDay')}
              />
            </div>
            <div className="control-group">
              <label>Moon Period: {moonPeriod}</label>
              <NumberEditor
                value={moonPeriod}
                onChange={value => void this.handleField(value, 'moonPeriod')}
              />
            </div>
            <div className="control-group">
              <label>Moon Tilt: {moonTilt}</label>
              <NumberEditor
                step={0.1}
                value={moonTilt}
                onChange={value => void this.handleField(value, 'moonTilt')}
              />
            </div>
          </div>
        </div>
        <div className="moon-display">
          <div
            className="moon-demo-container"
            style={{
              '--basis-icon-color': moonColor,
              '--basis-icon-color-secondary': moonSecondary,
            } as CSSProperties}
          >
            <Icons.MoonPhase
              day={moonDay}
              filled={moonFilled}
              period={moonPeriod}
              tilt={moonTilt}
            />
          </div>
          <span className="moon-phase-name">Moon Phase</span>
        </div>
      </div>
    )
  }

  content() {
    const {
      color, filled, filterText, iconColor, iconFilled, overlayColor, overlayFilled,
      overlayIcon, overlaySize, primaryIcon, showNames, size,
    } = this.current
    style('basis:docs:icons:dynamic', css`
      .icon-demo-container {
        --demo-icon-color: ${color || 'currentColor'};
        --demo-icon-size: ${size}px;
      }

      .overlay-demo-container {
        --basis-icon-color: ${iconColor || 'currentColor'};
        --basis-icon-overlay-color: ${overlayColor};
        --basis-icon-size: ${overlaySize}px;
      }
    `)

    return (
      <div className="icons-docs">
        <h1>Icons</h1>
        <p>The icons library provides a comprehensive collection of SVG icons for use throughout the application. All icons are built on the <code>IconBase</code> component and support consistent styling, sizing, and theming. The table glyph is exported as <code>Table</code> from <code>@basis/react/icons</code> so it does not collide with the <code>Table</code> component.</p>
        <h2>Icon Grid</h2>
        <p>Browse all available icons in the interactive grid below. Use the controls to customize the display:</p>
        <div className="controls-grid">
          <div className="control-group">
            <label>Size: {size}px</label>
            <NumberEditor
              step={4}
              value={size}
              onChange={value => void this.handleField(value, 'size')}
            />
          </div>
          <div className="control-group">
            <label>Color</label>
            <input
              className="color-input"
              type="color"
              value={color || '#000000'}
              onChange={event => void this.handleField(event.target.value, 'color')}
            />
          </div>
          <div className="control-group">
            <label>Filter Icons</label>
            <TextEditor
              placeholder="Search icons..."
              value={filterText}
              onChange={value => void this.handleField(value, 'filterText')}
            />
          </div>
          <div className="control-group">
            <label>Filled</label>
            <Button
              className={filled ? 'primary' : 'secondary'}
              onActivate={() => void this.handleField(!filled, 'filled')}
            >
              {filled ? 'Filled' : 'Outline'}
            </Button>
          </div>
          <div className="control-group">
            <label>Show Names</label>
            <Button
              className={showNames ? 'primary' : 'secondary'}
              onActivate={() => void this.handleField(!showNames, 'showNames')}
            >
              {showNames ? 'Hide Names' : 'Show Names'}
            </Button>
          </div>
        </div>
        <div style={{ marginBottom: '32px' }}>
          <h3>All Icons ({this.iconComponents.length})</h3>
          {this.renderIconGrid()}
        </div>
        <h2>Usage Examples</h2>
        <h3>Basic Icon Usage</h3>
        {Code.format(`
          import { AlignLeft, ListBulleted, Plus, Search } from 'basis/react'
          import { Table } from 'basis/react/icons'

          // Use individual icons
          <Plus />
          <Search />
          <AlignLeft />
          <ListBulleted />
          <Table />

          // With custom styling via CSS custom properties
          <div style={{ '--basis-icon-color': '#000000', '--basis-icon-size': '32px' }}>
            <Plus />
          </div>
          <Search disabled={true} />
        `)}
        <h2>Group/Set Icons</h2>
        {this.renderSpecialIcons()}
        <p>Some icons are more than simple graphics - they're interactive components with their own props and behavior. The following components follow the same pattern of grouping icon variants into a single component:</p>
        <ul>
          <li><strong>Triangle</strong>: Directional triangles with an <code>orientation</code> prop</li>
          <li><strong>Sort</strong>: Sort indicators with <code>sortBy</code> and <code>direction</code> props</li>
          <li><strong>Grip</strong>: Grip handles with an <code>orientation</code> prop</li>
          <li><strong>Zoom</strong>: Magnifiers with a <code>direction</code> prop</li>
        </ul>
        <p>This reduces the number of individual icon components while providing type-safe access to all variants.</p>
        <h3>Usage</h3>
        {Code.format(`
          import { Triangle, Sort, Grip, Zoom } from 'basis/react'

          // Triangle - directional arrows
          <Triangle orientation={Triangle.Orientation.Right} />
          <Triangle orientation={Triangle.Orientation.Up} />
          <Triangle orientation={Triangle.Orientation.Down} />
          <Triangle orientation={Triangle.Orientation.Left} />

          // Sort - table sorting indicators
          <Sort sortBy={Sort.By.Name} direction={Sort.Direction.Asc} />
          <Sort sortBy={Sort.By.Size} direction={Sort.Direction.Desc} />
          <Sort sortBy={Sort.By.Value} direction={Sort.Direction.Asc} />
          
          // Alternative syntax - direct component access
          <Sort.BySize.Desc />

          // Grip - drag handles for different positions
          <Grip orientation={Grip.Orientation.Horizontal} />
          <Grip orientation={Grip.Orientation.Vertical} />
          <Grip orientation={Grip.Orientation.TopLeft} />
          <Grip orientation={Grip.Orientation.BottomRight} />

          // Zoom - magnifier direction
          <Zoom direction={Zoom.Direction.In} />
          <Zoom direction={Zoom.Direction.Out} />

          // Alternative syntax - direct component access
          <Zoom.In />
          <Zoom.Out />
        `)}
        <h2>MoonPhase</h2>
        <p>The <code>MoonPhase</code> icon dynamically renders different lunar phases based on <code>day</code>, <code>period</code>, and <code>tilt</code>. Use it for astronomical data, calendar systems, or any interface that benefits from lunar phase visualization.</p>
        {this.renderMoonPhaseSection()}
        <h3>Parameters</h3>
        <p>The component accepts three key parameters that control its appearance:</p>
        <ul>
          <li><strong>day</strong> - The current day in the lunar cycle (0-28)</li>
          <li><strong>period</strong> - The total length of the lunar cycle (typically 28 days)</li>
          <li><strong>tilt</strong> - The rotation angle of the moon phase (0-1)</li>
        </ul>
        <h3>Usage Examples</h3>
        <h4>Basic Usage</h4>
        {Code.format(`
          import { MoonPhase } from 'basis/react'

          // Show different moon phases
          <MoonPhase day={0} period={28} tilt={0} />      // New moon
          <MoonPhase day={7} period={28} tilt={0} />      // First quarter
          <MoonPhase day={14} period={28} tilt={0} />     // Full moon
          <MoonPhase day={21} period={28} tilt={0} />     // Last quarter
        `)}
        <h4>With Custom Tilt</h4>
        {Code.format(`
          import { MoonPhase } from 'basis/react'

          // With custom tilt for different orientations
          <MoonPhase day={14} period={28} tilt={0.3} />
          <MoonPhase day={7} period={28} tilt={0.7} />
        `)}
        <h4>Different Periods</h4>
        {Code.format(`
          import { MoonPhase } from 'basis/react'

          // Custom lunar periods
          <MoonPhase day={10} period={30} tilt={0} />    // 30-day cycle
          <MoonPhase day={5} period={14} tilt={0} />     // 14-day cycle
        `)}
        <h3>Phase Calculation</h3>
        <p>The component automatically calculates the lunar phase based on the day and period parameters:</p>
        <ul>
          <li><strong>New Moon</strong> - day = 0 or day = period</li>
          <li><strong>Waxing Crescent</strong> - 0 &lt; day &lt; period/4</li>
          <li><strong>First Quarter</strong> - day = period/4</li>
          <li><strong>Waxing Gibbous</strong> - period/4 &lt; day &lt; period/2</li>
          <li><strong>Full Moon</strong> - day = period/2</li>
          <li><strong>Waning Gibbous</strong> - period/2 &lt; day &lt; 3*period/4</li>
          <li><strong>Last Quarter</strong> - day = 3*period/4</li>
          <li><strong>Waning Crescent</strong> - 3*period/4 &lt; day &lt; period</li>
        </ul>
        <h3>Styling</h3>
        <p>The Moon Phase component supports all standard icon styling options, plus duotone support:</p>
        {Code.format(`
          // CSS custom properties
          .moon-container {
            --basis-icon-color: #000000;              // Primary color (moon phase)
            --basis-icon-color-secondary: #11111144;  // Secondary color (background circle)
            --basis-icon-size: 48px;
          }

          // Component props
          <MoonPhase
            day={14}
            period={28}
            tilt={0}
            disabled={false}
            onClick={() => console.log('Moon clicked!')}
          />
        `)}
        <h3>Use Cases</h3>
        <ul>
          <li><strong>Calendar Applications</strong> - Display lunar phases in date pickers</li>
          <li><strong>Astronomy Apps</strong> - Show current moon phase for stargazing</li>
          <li><strong>Weather Applications</strong> - Include lunar data in weather displays</li>
          <li><strong>Gaming</strong> - Dynamic moon phases for day/night cycles</li>
          <li><strong>Educational Tools</strong> - Teach lunar cycle concepts</li>
        </ul>
        <h2>Icon Styling</h2>
        <p>Icons are styled using CSS custom properties. All icons inherit from <code>IconBase</code> and support the following styling options:</p>
        <ul>
          <li><strong>--basis-icon-color</strong> - Icon color (default: currentColor, shown as #000000 in picker)</li>
          <li><strong>--basis-icon-overlay-color</strong> - Overlay color (default: currentColor)</li>
          <li><strong>--basis-icon-size</strong> - Icon size (default: 1em)</li>
        </ul>
        <h3>Icon Props</h3>
        <p>Icons also support these component props:</p>
        <ul>
          <li><strong>disabled</strong> - Whether the icon is disabled (default: false)</li>
          <li><strong>onClick</strong> - Click handler function</li>
          <li><strong>overlay</strong> - Component (inherits <code>filled</code>) or element (keeps its own) in the lower-right quadrant</li>
        </ul>
        <h2>Overlays</h2>
        <p>Pass another icon as <code>overlay</code>. It fills the lower-right quadrant of the viewBox (half the width and height, a quarter of the area). A component overlay inherits <code>filled</code> from the main icon; pass an element to override. Color the main icon with <code>--basis-icon-color</code> and the overlay with <code>--basis-icon-overlay-color</code>.</p>
        <div className="overlay-section">
          <div className="overlay-controls">
            <div className="overlay-row">
              <div className="control-group">
                <label>Main Icon</label>
                <EnumEditor
                  enum={this.overlayableIconEnum}
                  value={primaryIcon}
                  onChange={value => void this.handleField(String(value), 'primaryIcon')}
                />
              </div>
              <div className="control-group">
                <label>Overlay Icon</label>
                <EnumEditor
                  enum={this.overlayableIconEnum}
                  value={overlayIcon}
                  onChange={value => void this.handleField(String(value), 'overlayIcon')}
                />
              </div>
              <div className="control-group">
                <label>Icon Size: {overlaySize}px</label>
                <NumberEditor
                  step={4}
                  value={overlaySize}
                  onChange={value => void this.handleField(value, 'overlaySize')}
                />
              </div>
            </div>
            <div className="overlay-row">
              <div className="control-group">
                <label>Main color</label>
                <input
                  className="color-input"
                  type="color"
                  value={iconColor || '#000000'}
                  onChange={event => void this.handleField(event.target.value, 'iconColor')}
                />
              </div>
              <div className="control-group">
                <label>Filled</label>
                <Button
                  className={iconFilled ? 'primary' : 'secondary'}
                  onActivate={() => void this.handleField(!iconFilled, 'iconFilled')}
                >
                  {iconFilled ? 'Filled' : 'Outline'}
                </Button>
              </div>
            </div>
            <div className="overlay-row">
              <div className="control-group">
                <label>Overlay color</label>
                <input
                  className="color-input"
                  type="color"
                  value={overlayColor}
                  onChange={event => void this.handleField(event.target.value, 'overlayColor')}
                />
              </div>
              <div className="control-group">
                <label>Filled</label>
                <Button
                  className={overlayFilled ? 'primary' : 'secondary'}
                  onActivate={() => void this.handleField(!overlayFilled, 'overlayFilled')}
                >
                  {overlayFilled ? 'Filled' : 'Outline'}
                </Button>
              </div>
            </div>
          </div>
          <div className="overlay-demo-container">
            {this.renderOverlayDemo()}
          </div>
        </div>
        {Code.format(`
          import { Lightning, Plus } from 'basis/react'

          <Lightning overlay={Plus} />
          <Lightning filled overlay={Plus} />
          <Lightning overlay={<Plus filled />} />
          <Lightning filled overlay={<Plus />} />
        `)}
        <h2>Accessibility</h2>
        <p>All icons are built with accessibility in mind:</p>
        <ul>
          <li>Icons use semantic SVG elements with proper ARIA attributes</li>
          <li>Color contrast ratios meet WCAG guidelines</li>
          <li>Icons can be disabled and styled appropriately</li>
          <li>Click handlers are keyboard accessible</li>
          <li>Screen readers can access icon content through proper labeling</li>
        </ul>
        <h2>Customization</h2>
        <p>Icons can be customized through CSS custom properties or by extending the <code>IconBase</code> component:</p>
        {Code.format(`
          // CSS custom properties customization
          .my-icon-container {
            --basis-icon-color: #000000;
            --basis-icon-size: 32px;
            transition: --basis-icon-color 0.2s ease;
          }

          .my-icon-container:hover {
            --basis-icon-color: #333333;
          }

          // Component extension
          class CustomIcon extends IconBase<Props> {
            renderContent = () => (
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            )
            viewBox = "0 0 24 24"
          }
        `)}
      </div>
    )
  }
}
