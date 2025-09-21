import * as React from 'react'
import { Button, css, NumberEditor, style } from '@basis/react'
import * as Icons from '@basis/react/icons'
import { Code } from '../components/Code'

import './MoonPhase.styles.ts'

interface State {
  color: string,
  day: number,
  filled: boolean,
  period: number,
  secondary: string,
  tilt: number,
}

export class MoonPhaseDocs extends React.Component<Record<string, never>, State> {
  state = {
    color: '#336699',
    day: 3.5,
    filled: true,
    period: 28,
    secondary: '#11111144',
    tilt: 28.5,
  }

  renderMoonPhaseSection = (): React.ReactNode => {
    const { color, day, filled, period, secondary, tilt } = this.state

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
                value={color}
                onChange={e => this.setState({ color: e.target.value })}
              />
            </div>
            <div className="control-group">
              <label>Secondary Color</label>
              <input
                className="color-input"
                type="color"
                value={secondary}
                onChange={e => this.setState({ secondary: e.target.value })}
              />
            </div>
            <div className="control-group">
              <label>Filled</label>
              <Button
                className={filled ? 'primary' : 'secondary'}
                onActivate={() => this.setState({ filled: !filled })}
              >
                {filled ? 'Filled' : 'Outline'}
              </Button>
            </div>
            <div className="control-group">
              <label>
                Moon Day: {day}
              </label>
              <NumberEditor
                value={day}
                onChange={value => this.setState({ day: value })}
              />
            </div>
            <div className="control-group">
              <label>
                Moon Period: {period}
              </label>
              <NumberEditor
                value={period}
                onChange={value => this.setState({ period: value })}
              />
            </div>
            <div className="control-group">
              <label>
                Moon Tilt: {tilt}
              </label>
              <NumberEditor
                step={0.1}
                value={tilt}
                onChange={value => this.setState({ tilt: value })}
              />
            </div>
          </div>
        </div>
        <div className="moon-display">
          <div
            className="moon-demo-container"
            style={{
              '--basis-icon-color': color,
              '--basis-icon-color-secondary': secondary,
            } as React.CSSProperties}
          >
            <Icons.MoonPhase
              day={day}
              filled={filled}
              period={period}
              tilt={tilt}
            />
          </div>
          <span className="moon-phase-name">
            Moon Phase
          </span>
        </div>
      </div>
    )
  }

  render() {
    style('basis:docs:moonphase:dynamic', css`
      .moon-demo-container {
        --basis-icon-size: 120px;
      }
    `)

    return (
      <div className="moon-phase-docs">
        <h1>Moon Phase Component</h1>
        <p>
          The Moon Phase component dynamically renders different lunar phases based on day, period, and tilt parameters.
          This component is perfect for applications that need to display astronomical data, calendar systems, or
          any interface that benefits from lunar phase visualization.
        </p>
        {this.renderMoonPhaseSection()}
        <h2>Parameters</h2>
        <p>
          The Moon Phase component accepts three key parameters that control its appearance:
        </p>
        <ul>
          <li><strong>day</strong> - The current day in the lunar cycle (0-28)</li>
          <li><strong>period</strong> - The total length of the lunar cycle (typically 28 days)</li>
          <li><strong>tilt</strong> - The rotation angle of the moon phase (0-1)</li>
        </ul>
        <h2>Usage Examples</h2>
        <h3>Basic Usage</h3>
        {Code.format(`
          import { MoonPhase } from '@basis/react'

          // Show different moon phases
          <MoonPhase day={0} period={28} tilt={0} />      // New moon
          <MoonPhase day={7} period={28} tilt={0} />      // First quarter
          <MoonPhase day={14} period={28} tilt={0} />     // Full moon
          <MoonPhase day={21} period={28} tilt={0} />     // Last quarter
        `)}
        <h3>With Custom Tilt</h3>
        {Code.format(`
          import { MoonPhase } from '@basis/react'

          // With custom tilt for different orientations
          <MoonPhase day={14} period={28} tilt={0.3} />
          <MoonPhase day={7} period={28} tilt={0.7} />
        `)}
        <h3>Different Periods</h3>
        {Code.format(`
          import { MoonPhase } from '@basis/react'

          // Custom lunar periods
          <MoonPhase day={10} period={30} tilt={0} />    // 30-day cycle
          <MoonPhase day={5} period={14} tilt={0} />     // 14-day cycle
        `)}
        <h2>Phase Calculation</h2>
        <p>
          The component automatically calculates the lunar phase based on the day and period parameters:
        </p>
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
        <h2>Styling</h2>
        <p>
          The Moon Phase component supports all standard icon styling options, plus duotone support:
        </p>
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
        <h2>Use Cases</h2>
        <ul>
          <li><strong>Calendar Applications</strong> - Display lunar phases in date pickers</li>
          <li><strong>Astronomy Apps</strong> - Show current moon phase for stargazing</li>
          <li><strong>Weather Applications</strong> - Include lunar data in weather displays</li>
          <li><strong>Gaming</strong> - Dynamic moon phases for day/night cycles</li>
          <li><strong>Educational Tools</strong> - Teach lunar cycle concepts</li>
        </ul>
      </div>
    )
  }
}
