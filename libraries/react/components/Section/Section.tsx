import * as React from 'react'
import { kebabCase } from '@basis/utilities'
import { Component } from '../Component/Component'
import { Router } from '../Router/Router.tsx'

import './Section.styles.ts'

interface Props {
  children: React.ReactNode,
  title?: string,
}

export class Section extends Component<Props> {
  static displayName = 'Section'

  get id(): string | undefined {
    return this.props.title ? kebabCase(this.props.title) : undefined
  }
  override get tag() { return 'section' as const }

  override get attributes() {
    return {
      ...super.attributes,
      'data-has-title': !!this.props.title,
      'id': this.id,
    }
  }

  override content(): React.ReactNode {
    const { children, title } = this.props

    return (
      <>
        {title && (
          <h2 className="title">
            {title}
            <Router.Link className="anchor" to={`#${this.id}`}>#</Router.Link>
          </h2>
        )}
        {children}
      </>
    )
  }
}
