import type { ComponentType, ReactNode } from 'react'
import type { IconProps } from '@basis/react'
import { Button, css, EnumEditor, NumberEditor, Router, style, TextEditor } from '@basis/react'
import * as Icons from '@basis/react/icons'
import { IconBase } from '../../react/icons/IconBase/IconBase'
import { Code } from '../components/Code'
import { Documentation } from '../components/Documentation'

import './Icons.styles.ts'

interface State {
  color: string,
  filled: boolean,
  filterText: string,
  iconColor: string,
  iconFilled: boolean,
  iconStroke: string,
  overlayColor: string,
  overlayFilled: boolean,
  overlayIcon: string,
  overlaySize: number,
  overlayStroke: string,
  primaryIcon: string,
  showNames: boolean,
  size: number,
}

export class IconsDocs extends Documentation<State> {
  static override defaultProps = {
    ...Documentation.defaultProps,
    initialValue: {
      color: '#000000',
      filled: false,
      filterText: '',
      iconColor: '#222222',
      iconFilled: false,
      iconStroke: '#222222',
      overlayColor: '#66aa66',
      overlayFilled: false,
      overlayIcon: 'Plus',
      overlaySize: 192,
      overlayStroke: '#558855',
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
        <span className="special-icon-name">
          Triangle (Right)
        </span>
      </div>
      {/* Sort Component */}
      <div className="special-icon-item">
        <div className="icon-demo-container">
          <Icons.Sort
            direction={Icons.Sort.Direction.Asc}
            sortBy={Icons.Sort.By.Name}
          />
        </div>
        <span className="special-icon-name">
          Sort (by name)
        </span>
      </div>
      {/* Grip Component */}
      <div className="special-icon-item">
        <div className="icon-demo-container">
          <Icons.Grip orientation={Icons.Grip.Orientation.Horizontal} />
        </div>
        <span className="special-icon-name">
          Grip (Horizontal)
        </span>
      </div>
    </div>
  )

  content() {
    const {
      color, filled, filterText, iconColor, iconFilled, iconStroke, overlayColor, overlayFilled,
      overlayIcon, overlaySize, overlayStroke, primaryIcon, showNames, size,
    } = this.current
    style('basis:docs:icons:dynamic', css`
      .icon-demo-container {
        --demo-icon-color: ${color};
        --demo-icon-size: ${size}px;
      }

      .overlay-demo-container {
        --basis-icon-color: ${iconColor};
        --basis-icon-overlay-color: ${overlayColor};
        --basis-icon-overlay-stroke: ${overlayStroke};
        --basis-icon-size: ${overlaySize}px;
        --basis-icon-stroke: ${iconStroke};
      }
    `)

    return (
      <div className="icons-docs">
        <h1>Icons</h1>
        <p>
          The icons library provides a comprehensive collection of SVG icons for use throughout the application.
          All icons are built on the <code>IconBase</code> component and support consistent styling, sizing, and
          theming.
        </p>
        <h2>Icon Grid</h2>
        <p>
          Browse all available icons in the interactive grid below. Use the controls to customize the display:
        </p>
        <div className="controls-grid">
          <div className="control-group">
            <label>
              Size: {size}px
            </label>
            <NumberEditor
              step={4}
              value={size}
              onChange={value => void this.handleField(value, 'size')}
            />
          </div>
          <div className="control-group">
            <label>
              Color
            </label>
            <input
              className="color-input"
              type="color"
              value={color}
              onChange={event => void this.handleField(event.target.value, 'color')}
            />
          </div>
          <div className="control-group">
            <label>
              Filter Icons
            </label>
            <TextEditor
              placeholder="Search icons..."
              value={filterText}
              onChange={value => void this.handleField(value, 'filterText')}
            />
          </div>
          <div className="control-group">
            <label>
              Filled
            </label>
            <Button
              className={filled ? 'primary' : 'secondary'}
              onActivate={() => void this.handleField(!filled, 'filled')}
            >
              {filled ? 'Filled' : 'Outline'}
            </Button>
          </div>
          <div className="control-group">
            <label>
              Show Names
            </label>
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
          import { Plus, Search, Gear } from '@basis/react'

          // Use individual icons
          <Plus />
          <Search />
          <Gear />

          // With custom styling via CSS custom properties
          <div style={{ '--basis-icon-color': '#000000', '--basis-icon-size': '32px' }}>
            <Plus />
          </div>
          <Search disabled={true} />
        `)}
        <h2>Group/Set Icons</h2>
        {this.renderSpecialIcons()}
        <p>
          Some icons are more than simple graphics - they're interactive components with their own props and behavior.
          The following three components follow the same pattern of grouping icon variants into a single component:
        </p>
        <ul>
          <li><strong>Triangle</strong>: Directional triangles with an <code>orientation</code> prop</li>
          <li><strong>Sort</strong>: Sort indicators with <code>sortBy</code> and <code>direction</code> props</li>
          <li><strong>Grip</strong>: Grip handles with an <code>orientation</code> prop</li>
        </ul>
        <p>This reduces the number of individual icon components while providing type-safe access to all variants.</p>
        <h3>Usage</h3>
        {Code.format(`
          import { Triangle, Sort, Grip } from '@basis/react'

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
        `)}
        <p>
          For detailed information about the Moon Phase component, see the
          <Router.Link to="/icons/MoonPhase">MoonPhase documentation</Router.Link>.
        </p>
        <h2>Icon Styling</h2>
        <p>
          Icons are styled using CSS custom properties. All icons inherit from <code>IconBase</code> and
          support the following styling options:
        </p>
        <ul>
          <li><strong>--basis-icon-size</strong> - Icon size (default: 1em)</li>
          <li><strong>--basis-icon-color</strong> - Icon color (default: currentColor, shown as #000000 in picker)</li>
          <li><strong>--basis-icon-stroke</strong> - Icon stroke color (default: transparent)</li>
          <li><strong>--basis-icon-overlay-color</strong> - Overlay color (default: currentColor)</li>
          <li><strong>--basis-icon-overlay-stroke</strong> - Overlay stroke color (default: currentColor)</li>
        </ul>
        <h3>Icon Props</h3>
        <p>
          Icons also support these component props:
        </p>
        <ul>
          <li><strong>disabled</strong> - Whether the icon is disabled (default: false)</li>
          <li><strong>onClick</strong> - Click handler function</li>
          <li>
            <strong>overlay</strong> - Component (inherits <code>filled</code>) or element (keeps its own) in the
            lower-right quadrant
          </li>
        </ul>
        <h2>Overlays</h2>
        <p>
          Pass another icon as <code>overlay</code>. It fills the lower-right quadrant of the viewBox
          (half the width and height, a quarter of the area). A component overlay inherits
          {' '}<code>filled</code> from the main icon; pass an element to override. Color the main icon with
          {' '}<code>--basis-icon-color</code> and <code>--basis-icon-stroke</code>, and the overlay with
          {' '}<code>--basis-icon-overlay-color</code> and <code>--basis-icon-overlay-stroke</code>.
        </p>
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
                <label>Main stroke</label>
                <input
                  className="color-input"
                  type="color"
                  value={iconStroke}
                  onChange={event => void this.handleField(event.target.value, 'iconStroke')}
                />
              </div>
              <div className="control-group">
                <label>Main fill</label>
                <input
                  className="color-input"
                  type="color"
                  value={iconColor}
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
                <label>Overlay stroke</label>
                <input
                  className="color-input"
                  type="color"
                  value={overlayStroke}
                  onChange={event => void this.handleField(event.target.value, 'overlayStroke')}
                />
              </div>
              <div className="control-group">
                <label>Overlay fill</label>
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
          import { Lightning, Plus } from '@basis/react'

          <Lightning overlay={Plus} />
          <Lightning filled overlay={Plus} />
          <Lightning overlay={<Plus filled />} />
          <Lightning filled overlay={<Plus />} />
        `)}
        <h2>Accessibility</h2>
        <p>
          All icons are built with accessibility in mind:
        </p>
        <ul>
          <li>Icons use semantic SVG elements with proper ARIA attributes</li>
          <li>Color contrast ratios meet WCAG guidelines</li>
          <li>Icons can be disabled and styled appropriately</li>
          <li>Click handlers are keyboard accessible</li>
          <li>Screen readers can access icon content through proper labeling</li>
        </ul>
        <h2>Customization</h2>
        <p>
          Icons can be customized through CSS custom properties or by extending the <code>IconBase</code> component:
        </p>
        {Code.format(`
          // CSS custom properties customization
          .my-icon-container {
            --basis-icon-color: #000000;
            --basis-icon-size: 32px;
            --basis-icon-stroke: #0056b3;
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
