import type { CSSProperties, ReactNode } from 'react'
import { AnchorPoint, Component, Tooltip } from '@basis/react'

type Align = 'center' | 'end' | 'start'
type Vertical = 'center' | 'end' | 'start'

interface ScenarioProps {
  /** Horizontal placement of the anchor within the bounded pane. */
  align: Align,
  /** Anchor point requested for the tooltip. */
  anchorPoint: AnchorPoint,
  /** Tooltip content. */
  content: ReactNode,
  /** Caption for the scenario. */
  label: string,
  /** Stable id used by the docs screenshot tests. */
  scenario: string,
  /** Vertical placement of the anchor within the bounded pane. */
  vertical: Vertical,
}

const grid: CSSProperties = {
  display: 'grid',
  gap: '1rem',
  gridTemplateColumns: 'repeat(auto-fit, minmax(20rem, 1fr))',
}

const pane: CSSProperties = {
  border: '1px solid var(--basis-color-border, #ccc)',
  borderRadius: '4px',
  height: '10rem',
  overflow: 'hidden',
  position: 'relative',
}

const caption: CSSProperties = {
  fontSize: '0.8rem',
  fontWeight: 600,
  marginBottom: '0.25rem',
}

/*
 * A multi-line, fixed-width body makes the tooltip wider than the space beside
 * an edge anchor without exceeding the pane itself, so `shift` can keep it
 * inside and the arrow is visibly off-center.
 */
const body: CSSProperties = {
  display: 'inline-block',
  whiteSpace: 'normal',
  width: '12rem',
}

/**
 * Places the anchor inside the pane using absolute offsets.
 * @param align The horizontal alignment.
 * @param vertical The vertical alignment.
 * @returns The inline style for the anchor wrapper.
 */
function anchorStyle(align: Align, vertical: Vertical): CSSProperties {
  const style: CSSProperties = { position: 'absolute' }
  const transforms: string[] = []

  if (align === 'start') style.left = '0.75rem'
  else if (align === 'end') style.right = '0.75rem'
  else {
    style.left = '50%'
    transforms.push('translateX(-50%)')
  }

  if (vertical === 'start') style.top = '0.75rem'
  else if (vertical === 'end') style.bottom = '0.75rem'
  else {
    style.top = '50%'
    transforms.push('translateY(-50%)')
  }

  if (transforms.length > 0) style.transform = transforms.join(' ')
  return style
}

/**
 * One bounded pane with an always-visible tooltip anchored near an edge.
 *
 * The pane is named as the tooltip's `boundary` by CSS class, which the Popup
 * mixin resolves with `closest` from the anchor. Floating UI then clips the
 * flip and shift middleware to the pane's visible box: the tooltip repositions
 * (and its arrow slides off-center) rather than escaping the container.
 */
export class TooltipBoundaryScenario extends Component<ScenarioProps, HTMLDivElement> {
  static displayName = 'TooltipBoundaryScenario'

  content() {
    const { align, anchorPoint, content, label, scenario, vertical } = this.props
    return (
      <figure data-tooltip-scenario={scenario} style={{ margin: 0 }}>
        <figcaption style={caption}>{label}</figcaption>
        <div className="tooltip-boundary-pane" style={pane}>
          <span style={anchorStyle(align, vertical)}>
            <button type="button">
              Anchor
              <Tooltip
                anchorPoint={anchorPoint}
                boundary=".tooltip-boundary-pane"
                offset={8}
                visible={true}
              >
                <span style={body}>{content}</span>
              </Tooltip>
            </button>
          </span>
        </div>
      </figure>
    )
  }
}

/** Grid of boundary scenarios: both flips and shifts in every direction. */
export class TooltipBoundaryExample extends Component<Record<string, never>, HTMLDivElement> {
  static displayName = 'TooltipBoundaryExample'

  content() {
    return (
      <div className="tooltip-boundary-examples" style={grid}>
        <TooltipBoundaryScenario
          align="center"
          anchorPoint={AnchorPoint.Top}
          content="No room above, so it flips below."
          label="Top edge: flip"
          scenario="top"
          vertical="start"
        />
        <TooltipBoundaryScenario
          align="center"
          anchorPoint={AnchorPoint.Bottom}
          content="No room below, so it flips above."
          label="Bottom edge: flip"
          scenario="bottom"
          vertical="end"
        />
        <TooltipBoundaryScenario
          align="start"
          anchorPoint={AnchorPoint.Left}
          content="No room to the left, so it flips right."
          label="Left edge: flip"
          scenario="left"
          vertical="center"
        />
        <TooltipBoundaryScenario
          align="end"
          anchorPoint={AnchorPoint.Right}
          content="No room to the right, so it flips left."
          label="Right edge: flip"
          scenario="right"
          vertical="center"
        />
        <TooltipBoundaryScenario
          align="end"
          anchorPoint={AnchorPoint.Top}
          content="Wide tooltip shifts left; arrow off-center."
          label="Top-right: shift"
          scenario="top-right"
          vertical="start"
        />
        <TooltipBoundaryScenario
          align="start"
          anchorPoint={AnchorPoint.Bottom}
          content="Wide tooltip shifts right; arrow off-center."
          label="Bottom-left: shift"
          scenario="bottom-left"
          vertical="end"
        />
      </div>
    )
  }
}
