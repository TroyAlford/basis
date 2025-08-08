import * as React from 'react'
import { noop } from '@basis/utilities'
import { css, style } from '../../utilities/style'
import { Component } from '../Component/Component'

/** Props for the Tag component. */
interface Props {
  /** The children of the tag. */
  children: React.ReactNode,
  /** Callback function called when the remove button is clicked. */
  onRemove?: () => void,
  /** Whether the tag can be removed. @default false */
  removable?: boolean,
}

/** Tag component that displays content with an optional remove button. */
export class Tag extends Component<Props, HTMLSpanElement> {
  static displayName = 'Tag'

  /** Default props for tag. */
  static defaultProps: Props = {
    children: null,
    onRemove: noop,
    removable: false,
  }

  get attributes() {
    return {
      ...super.attributes,
      'data-removable': this.props.removable,
    }
  }

  /**
   * Handles the remove button click.
   * @param event - The event object.
   */
  #handleRemove = (event: React.MouseEvent<HTMLAnchorElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    this.props.onRemove()
  }

  content(): React.ReactNode {
    const { children, removable } = this.props

    return (
      <>
        <span className="content">
          {children}
        </span>
        {removable && (
          <a
            aria-label="Remove tag"
            className="remove"
            href="#"
            type="button"
            onClick={this.#handleRemove}
          >
            ×
          </a>
        )}
      </>
    )
  }
}

style('basis:tag', css`
  .tag.component {
    align-items: center;
    border: 1px solid currentColor;
    border-radius: .25em;
    color: currentColor;
    display: inline-flex;
    font-size: .8em;
    gap: .1em;
    line-height: 1;
    padding: .1em .25em;
    height: min-content;
    white-space: nowrap;

    &[data-theme] {
      color: var(--basis-color-primary);
    }

    > .content {
      color: currentColor;
      flex: 1;
    }

    > .remove {
      align-items: center;
      color: currentColor;
      cursor: pointer;
      display: flex;
      font-weight: bold;
      height: 1em;
      justify-content: center;
      text-decoration: none;
      padding: 0;
      width: 1em;

      &:focus {
        outline: 2px solid currentColor;
      }
    }
  }
`)
