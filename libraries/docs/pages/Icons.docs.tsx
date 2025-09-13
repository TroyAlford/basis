/* eslint-disable @import/no-default-export */
import * as React from 'react'
import type { IconProps } from '@basis/icons'
import * as Icons from '@basis/icons'
import { Button, css, NumberEditor, style, TextEditor } from '@basis/react'
import { Code } from '../components/Code'

import './Icons.styles.ts'

interface State {
  filled: boolean,
  filterText: string,
  iconColor: string,
  iconSize: number,
  moonDay: number,
  moonPeriod: number,
  moonTilt: number,
  showNames: boolean,
}

export default class IconsDocs extends React.Component<Record<string, never>, State> {
  state = {
    filled: false,
    filterText: '',
    iconColor: '#369',
    iconSize: 60,
    moonDay: 3.5,
    moonPeriod: 28,
    moonTilt: 28.5,
    showNames: true,
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

  renderSpecialIcons = (): React.ReactNode => {
    const { moonDay, moonPeriod, moonTilt } = this.state

    return (
      <div className="special-icons-grid">
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
        {/* Moon Phase Component */}
        <div className="special-icon-item">
          <div className="icon-demo-container">
            <Icons.MoonPhase
              day={moonDay}
              period={moonPeriod}
              tilt={moonTilt}
            />
          </div>
          <span className="special-icon-name">
            Moon Phase
          </span>
        </div>
      </div>
    )
  }

  render() {
    const { filled, filterText, iconColor, iconSize, moonDay, moonPeriod, moonTilt, showNames } = this.state
    style('basis:docs:icons:dynamic', css`
      .icon-demo-container {
        --demo-icon-color: ${iconColor};
        --demo-icon-size: ${iconSize}px;
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
              Size: {iconSize}px
            </label>
            <NumberEditor
              step={4}
              value={iconSize}
              onChange={value => this.setState({ iconSize: value })}
            />
          </div>
          <div className="control-group">
            <label>
              Color
            </label>
            <input
              className="color-input"
              type="color"
              value={iconColor}
              onChange={e => this.setState({ iconColor: e.target.value })}
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
        <h2>Special Components</h2>
        <p>
          Some icons are more than simple graphics - they're interactive components with their own props and behavior:
        </p>
        <div className="moon-controls-grid">
          <div className="control-group">
            <label>
              Moon Day: {moonDay}
            </label>
            <NumberEditor
              value={moonDay}
              onChange={value => this.setState({ moonDay: value })}
            />
          </div>
          <div className="control-group">
            <label>
              Moon Period: {moonPeriod}
            </label>
            <NumberEditor
              value={moonPeriod}
              onChange={value => this.setState({ moonPeriod: value })}
            />
          </div>
          <div className="control-group">
            <label>
              Moon Tilt: {moonTilt}
            </label>
            <NumberEditor
              step={0.1}
              value={moonTilt}
              onChange={value => this.setState({ moonTilt: value })}
            />
          </div>
        </div>
        {this.renderSpecialIcons()}
        <h2>Usage Examples</h2>
        <h3>Basic Icon Usage</h3>
        {Code.format(`
          import { Plus, Search, Gear } from '@basis/icons'

          // Use individual icons
          <Plus />
          <Search />
          <Gear />

          // With custom styling via CSS custom properties
          <div style={{ '--basis-icon-color': '#007bff', '--basis-icon-size': '32px' }}>
            <Plus />
          </div>
          <Search disabled={true} />
        `)}
        <h3>Dynamic Icon Rendering</h3>
        {Code.format(`
          import { Icon } from '@basis/icons'

          // Render icons by name
          <Icon named="Plus" />
          <Icon named="Search" />
          <Icon named="Gear" />

          // With custom styling via CSS custom properties
          <div style={{ '--basis-icon-color': '#28a745', '--basis-icon-size': '24px' }}>
            <Icon named="Plus" />
          </div>
        `)}
        <h3>Sort Component</h3>
        {Code.format(`
          import { Sort, SortBy, SortDirection } from '@basis/icons'

          // Sort by different criteria
          <Sort by={SortBy.Name} direction={SortDirection.Asc} />
          <Sort by={SortBy.Size} direction={SortDirection.Desc} />
          <Sort by={SortBy.Value} direction={SortDirection.Asc} />

          // No sort state
          <Sort by={SortBy.None} />
        `)}
        <h3>Moon Phase Component</h3>
        {Code.format(`
          import { MoonPhase } from '@basis/icons'

          // Show different moon phases
          <MoonPhase day={0} period={28} tilt={0} />      // New moon
          <MoonPhase day={7} period={28} tilt={0} />      // First quarter
          <MoonPhase day={14} period={28} tilt={0} />     // Full moon
          <MoonPhase day={21} period={28} tilt={0} />     // Last quarter

          // With custom tilt
          <MoonPhase day={14} period={28} tilt={0.3} />
        `)}
        <h2>Icon Styling</h2>
        <p>
          Icons are styled using CSS custom properties. All icons inherit from <code>IconBase</code> and
          support the following styling options:
        </p>
        <ul>
          <li><strong>--basis-icon-size</strong> - Icon size (default: 1em)</li>
          <li><strong>--basis-icon-color</strong> - Icon color (default: currentColor)</li>
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
            --basis-icon-color: #007bff;
            --basis-icon-size: 32px;
            --basis-icon-stroke: #0056b3;
            transition: --basis-icon-color 0.2s ease;
          }

          .my-icon-container:hover {
            --basis-icon-color: #0056b3;
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
