import * as React from 'react'
import { Component } from '../Component/Component'

import './Mermaid.styles.ts'

/** Source of the lazily loaded Mermaid runtime. */
export const MERMAID_SOURCE = 'https://esm.sh/mermaid@11'

interface Props {
  /** Mermaid diagram source. */
  children?: React.ReactNode,
}

interface State {
  /** The rendered SVG, once the runtime has run. */
  svg: string | null,
}

let sequence = 0

/**
 * Renders a Mermaid diagram. The runtime is imported lazily on mount, so a page
 * that does not use diagrams never fetches it and server rendering never
 * reaches the network: SSR emits the source as the runtime's `<pre
 * class="mermaid">` block, and the client replaces it with the rendered SVG.
 */
export class Mermaid extends Component<Props, HTMLDivElement, State> {
  static displayName = 'MermaidDiagram'
  #id = `basis-mermaid-${(sequence += 1)}`

  get defaultState(): State {
    return { svg: null }
  }

  /**
   * The diagram source, from the element's text children.
   * @returns The diagram source.
   */
  get source(): string {
    return React.Children.toArray(this.props.children).join('').trim()
  }

  async componentDidMount(): Promise<void> {

    const { default: mermaid } = await import(MERMAID_SOURCE)
    mermaid.initialize({ startOnLoad: false })
    const { svg } = await mermaid.render(this.#id, this.source)
    await this.setState({ svg })
  }

  content(): React.ReactNode {
    const { svg } = this.state
    if (svg) return <div className="diagram" dangerouslySetInnerHTML={{ __html: svg }} />
    return <pre className="mermaid">{this.source}</pre>
  }
}
