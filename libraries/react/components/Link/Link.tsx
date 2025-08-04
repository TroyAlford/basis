import type React from 'react'
import { Component } from '../Component/Component'

interface Props {
  /** Whether to replace the current history entry instead of adding a new one. */
  replace?: boolean,
  /** The URL to navigate to. */
  to: string,
}

/** A component for navigating to a URL. */
export class Link extends Component<Props, HTMLAnchorElement> {
  get attributes(): React.HTMLAttributes<HTMLAnchorElement> {
    return { href: this.props.to } as React.HTMLAttributes<HTMLAnchorElement>
  }
  get tag(): Component<Props, HTMLAnchorElement>['tag'] { return 'a' }

  componentDidMount(): void {
    const options = { capture: true, passive: false }
    this.rootNode.addEventListener('click', this.handleNativeClick, options)
    this.rootNode.addEventListener('keydown', this.handleNativeKeyDown, options)
  }

  /**
   * Handles the click event.
   * @param event - The pointer event.
   */
  private handleNativeClick = (event: PointerEvent) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return
    this.handleNavigate(event)
  }

  /**
   * Handles the key down event.
   * @param event - The keyboard event.
   */
  private handleNativeKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return
    this.handleNavigate(event)
  }

  /**
   * Handles the navigation.
   * @param event - The pointer or keyboard event.
   */
  private handleNavigate = (event: PointerEvent | KeyboardEvent) => {
    event.stopPropagation()
    event.preventDefault()
    history[this.props.replace ? 'replaceState' : 'pushState']({}, '', this.props.to)
  }
}
