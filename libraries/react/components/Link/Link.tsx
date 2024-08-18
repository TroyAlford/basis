import React from 'react'
import { Component } from '../Component/Component'

interface Props {
  replace?: boolean,
  to: string,
}

export class Link extends Component<Props, HTMLAnchorElement> {
  get attributes() {
    return { href: this.props.to } as React.HTMLAttributes<HTMLAnchorElement>
  }
  readonly tag: keyof React.ReactHTML = 'a'

  componentDidMount(): void {
    const options = { capture: true, passive: false }
    this.rootNode.addEventListener('click', this.handleClick, options)
    this.rootNode.addEventListener('keydown', this.handleKeyDown, options)
  }

  private handleClick = (event: PointerEvent) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return
    this.handleNavigate(event)
  }

  private handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return
    this.handleNavigate(event)
  }

  private handleNavigate = event => {
    event.stopPropagation()
    event.preventDefault()
    history[this.props.replace ? 'replaceState' : 'pushState']({}, '', this.props.to)
  }
}
