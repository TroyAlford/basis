import * as React from 'react'
import { Direction } from '../../types/Direction'
import { css, style } from '../../utilities/style'
import { Component } from '../Component/Component'

/** Props for the Tooltip component. */
interface Props {
  /** The animation duration for the tooltip. */
  animationDuration?: string,
  /** The children of the tooltip. */
  children: React.ReactNode,
  /** The direction where the tooltip should appear. */
  direction?: Direction,
  /** The offset distance from the parent element. If a number is provided, 'px' will be appended. */
  offset?: string | number,
  /** Whether the tooltip is visible. */
  visible?: boolean | 'auto',
}

/**
 * A tooltip bubble that anchors to its nearest parent element automatically.
 * Place it as a direct child of the element you want to describe.
 * @example
 * <div className="some component">
 *   Content
 *   <Tooltip direction={Tooltip.Direction.NE} offset={8} animationDuration=".2s">
 *     Tooltip Content!
 *   </Tooltip>
 * </div>
 */
export class Tooltip extends Component<Props, HTMLDivElement> {
  static displayName = 'Tooltip'

  /** Direction enum for tooltip positioning. */
  static Direction = Direction

  /** Default props for tooltip. */
  static defaultProps: Props = {
    animationDuration: '.125s',
    children: null,
    direction: Direction.N,
    offset: '.25em',
    visible: 'auto',
  }

  get attributes() {
    return {
      ...super.attributes,
      'data-direction': this.props.direction,
      'data-visible': this.props.visible,
      'role': 'tooltip',
      'style': {
        '--tooltip-animation-duration': this.props.animationDuration,
        '--tooltip-offset': this.offset,
      },
    }
  }

  get classNames(): Set<string> {
    return super.classNames.add('tooltip')
  }

  /**
   * Converts the offset prop to a CSS string.
   * If it's a number, appends 'px'. If it's a string, returns as-is.
   * @returns The CSS string representation of the offset
   */
  get offset(): string {
    const { offset } = this.props
    if (typeof offset === 'number') {
      return `${offset}px`
    }
    return offset || '.25em'
  }

  content(children?: React.ReactNode): React.ReactNode {
    return (
      <>
        <div className="bubble">
          {children}
        </div>
        <div className="arrow" />
      </>
    )
  }
}

// Inject the tooltip styles (CSS-only show/hide; absolute positioning)
style('basis:tooltip', css`
  :root {
    --tooltip-animation-duration: .125s;
    --tooltip-offset: .25em;
    --tooltip-color-background: var(--basis-color-background);
    --tooltip-color-border: var(--basis-color-foreground);
    --tooltip-color-foreground: var(--basis-color-foreground);
  }

  .tooltip.component {
    inset: calc(var(--tooltip-offset) * -1);
    opacity: 0;
    position: absolute;
    pointer-events: none;
    transition:
      opacity var(--tooltip-animation-duration) ease,
      visibility var(--tooltip-animation-duration) linear,
      transform var(--tooltip-animation-duration) ease
    ;
    visibility: hidden;

    *:has(> &) {
      &:is(:hover, :focus-within) > .tooltip.component {
        opacity: 1;
        visibility: visible;
        z-index: 1;
      }
    }

    &[data-visible="true"] {
      opacity: 1;
      visibility: visible;
      z-index: 1;
    }

    > .bubble {
      background-color: var(--tooltip-color-background);
      border: 1px solid var(--tooltip-color-border);
      border-radius: 4px;
      color: var(--tooltip-color-foreground);
      padding: 8px;
      position: absolute;
    }

    > .arrow {
      background-color: var(--tooltip-color-background);
      border: 1px solid var(--tooltip-color-border);
      border-width: 1px 1px 0 0;
      height: 8px;
      position: absolute;
      width: 8px;
    }

    &[data-direction^="N"] {
      > .bubble, > .arrow { bottom: calc(100%); }
      > .bubble { margin-bottom: 4px; }
      > .arrow { transform: rotate(135deg); }
    }

    &[data-direction^="S"] {
      > .bubble, > .arrow { top: calc(100%); }
      > .bubble { margin-top: 4px; }
      > .arrow { transform: rotate(-45deg); }
    }

    &[data-direction="NW"], &[data-direction="SW"] {
      > .bubble { left: 0; }
      > .arrow { left: 8px; }
    }
    &[data-direction="NE"], &[data-direction="SE"] {
      > .bubble { right: 0; }
      > .arrow { right: 8px; }
    }

    &[data-direction="S"], &[data-direction="N"] {
      > .bubble {
        left: 50%;
        transform: translateX(-50%);
      }
      > .arrow { left: calc(50% - 4px); }
    }

    &[data-direction="E"] {
      > .bubble {
        left: calc(100% + 4px);
        transform: translate(4px, -50%);
        top: 50%;
      }
      
      > .arrow {
        top: calc(50% - 4px);
        left: calc(100% + 4px);
        transform: rotate(-135deg);
      }
    }

    &[data-direction="W"] {
      > .bubble {
        right: calc(100% + 4px);
        top: 50%;
        transform: translate(-4px, -50%);
      }

      > .arrow {
        right: calc(100% + 4px);
        top: calc(50% - 4px);
        transform: rotate(45deg);
      }
    }
  }
`)
