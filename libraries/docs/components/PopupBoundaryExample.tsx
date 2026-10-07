import type { CSSProperties } from 'react'
import { AnchorPoint, Component, Tooltip } from '@basis/react'

const examples: CSSProperties = {
  display: 'grid',
  gap: '1rem',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
}

/*
 * The top margin leaves room for the unbounded tooltip to escape its pane
 * without covering the column label.
 */
const pane: CSSProperties = {
  border: '1px solid var(--basis-color-border, #ccc)',
  borderRadius: '4px',
  height: '8rem',
  marginTop: '3.5rem',
  overflow: 'hidden',
  padding: '0.5rem',
  position: 'relative',
}

interface State {
  boundary: HTMLDivElement | null,
}

/**
 * Side-by-side demo of the Popup `boundary` option.
 *
 * Both panes anchor the same tooltip near their top edge. Without a boundary
 * Floating UI only knows about the viewport, so the tooltip slides above the
 * pane. With the pane named as the boundary it flips below the anchor and stays
 * inside the pane's visible box.
 */
export class PopupBoundaryExample extends Component<Record<string, never>, HTMLDivElement, State> {
  static displayName = 'PopupBoundaryExample'

  get defaultState(): State {
    return { boundary: null }
  }

  /*
   * The boundary element lives in this component's own render, so its ref is not
   * attached when the child Tooltip first mounts. Capturing it with a callback
   * ref and promoting it to state forces the re-render that hands the element to
   * the Popup mixin.
   */
  private readonly captureBoundary = (node: HTMLDivElement | null) => {
    if (this.state.boundary === node) return
    this.setState({ boundary: node })
  }

  content() {
    const { boundary } = this.state
    return (
      <div style={examples}>
        <div>
          <strong>No boundary</strong>
          <div style={pane}>
            <button type="button">Anchor near the top<Tooltip anchorPoint={AnchorPoint.Top} offset={8} visible={true}>Slips above the pane.</Tooltip></button>
          </div>
        </div>
        <div>
          <strong>Custom boundary</strong>
          <div ref={this.captureBoundary} style={pane}>
            <button type="button">
              Anchor near the top
              <Tooltip
                anchorPoint={AnchorPoint.Top}
                boundary={boundary ?? undefined}
                offset={8}
                visible={true}
              >
                Flips inside the pane.
              </Tooltip>
            </button>
          </div>
        </div>
      </div>
    )
  }
}
