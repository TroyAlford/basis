import * as React from 'react'
import type { IconProps } from '@basis/icons'
import * as Icons from '@basis/icons'
import { Button, css, NumberEditor, Router, style, TextEditor } from '@basis/react'
import { Code } from '../components/Code'

import './Icons.styles.ts'

interface State {
  color: string,
  filled: boolean,
  filterText: string,
  showNames: boolean,
  size: number,
}

export class IconsDocs extends React.Component<Record<string, never>, State> {
  state = {
    color: '#000000',
    filled: false,
    filterText: '',
    showNames: true,
    size: 60,
  }

  // Get all icon components (excluding Icon, IconBase, and utility components)
  get iconComponents() {
    const excludeComponents = ['Icon', 'IconBase', 'Sort', 'MoonPhase']
    return Object.entries(Icons as unknown as Record<string, React.ComponentType<IconProps>>)
      .filter(([name]) => !excludeComponents.includes(name))
      .filter(([name]) => typeof Icons[name] === 'function')
      .filter(([name]) => {
        if (this.state.filterText) {
          return name.toLowerCase().includes(this.state.filterText.toLowerCase())
        }
        return true
      })
      .sort(([a], [b]) => a.localeCompare(b))
  }

  renderIconGrid = (): React.ReactNode => {
    const { filled, showNames } = this.state

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

  renderSpecialIcons = (): React.ReactNode => (
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

  render() {
    const { color, filled, filterText, showNames, size } = this.state
    style('basis:docs:icons:dynamic', css`
      .icon-demo-container {
        --demo-icon-color: ${color};
        --demo-icon-size: ${size}px;
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
              onChange={value => this.setState({ size: value })}
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
              onChange={event => this.setState({ color: event.target.value })}
            />
          </div>
          <div className="control-group">
            <label>
              Filter Icons
            </label>
            <TextEditor
              placeholder="Search icons..."
              value={filterText}
              onChange={value => this.setState({ filterText: value })}
            />
          </div>
          <div className="control-group">
            <label>
              Filled
            </label>
            <Button
              className={filled ? 'primary' : 'secondary'}
              onActivate={() => this.setState({ filled: !filled })}
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
              onActivate={() => this.setState({ showNames: !showNames })}
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
          import { Plus, Search, Gear } from '@basis/icons'

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
          import { Triangle, Sort, Grip } from '@basis/icons'

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
          <li><strong>overlay</strong> - Overlay component for additional graphics</li>
        </ul>
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
