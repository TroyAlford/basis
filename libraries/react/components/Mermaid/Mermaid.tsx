import * as React from 'react'
import { Await } from '../Await/Await'
import { Component } from '../Component/Component'

import './Mermaid.styles.ts'

/** Source of the lazily loaded Mermaid runtime. */
export const MERMAID_SOURCE = 'https://esm.sh/mermaid@11'

interface Props {
  /** Mermaid diagram source. */
  children?: React.ReactNode,
}

let sequence = 0

/**
 * Renders a Mermaid diagram, loading the Mermaid runtime only when a diagram is
 * present, so pages that do not use diagrams never fetch it. Server rendering
 * emits the source as a `<pre class="mermaid">` fallback until the runtime runs.
 */
export class Mermaid extends Component<Props> {
  static displayName = 'MermaidDiagram'
  #id = `basis-mermaid-${(sequence += 1)}`

  /**
   * The diagram source, from the element's text children.
   * @returns The diagram source.
   */
  get source(): string {
    return React.Children.toArray(this.props.children).join('').trim()
  }

  /**
   * Load Mermaid and render the diagram to SVG.
   * @returns The rendered diagram.
   */
  async renderDiagram(): Promise<React.ReactNode> {

    const { default: mermaid } = await import(MERMAID_SOURCE)
    mermaid.initialize({ startOnLoad: false })
    const { svg } = await mermaid.render(this.#id, this.source)
    return <div className="diagram" dangerouslySetInnerHTML={{ __html: svg }} />
  }

  content(): React.ReactNode {
    return super.content(
      <Await fallback={<pre className="mermaid">{this.source}</pre>}>
        {this.renderDiagram()}
      </Await>,
    )
  }
}
