import * as React from 'react'
import { noop } from '@basis/utilities'
import { Component } from '../Component/Component'

import './Tag.styles.ts'

/** Props for the Tag component. */
interface Props {
  /** The children of the tag. */
  children: React.ReactNode,
  /** Callback function called when the remove button is clicked. */
  onRemove?: (event: React.MouseEvent<HTMLAnchorElement>) => void,
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
    this.props.onRemove(event)
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
