import { renderMermaidSVG } from 'beautiful-mermaid'
import * as React from 'react'
import { Component } from '../Component/Component'

import './Mermaid.styles.ts'

interface Props {
  /** Mermaid diagram source. */
  children?: React.ReactNode,
}

/** The Basis UI font, applied to diagram labels. */
const FONT = "'Ubuntu', sans-serif"

/**
 * Render diagram source to SVG, painted from the Basis design tokens.
 *
 * Colors are passed as CSS custom properties rather than resolved hex, so a
 * diagram follows whatever `Theme` scope it renders in — including server
 * rendering, where there is no computed style to read.
 * @param source - The diagram source.
 * @returns The SVG, or null when the source cannot be parsed.
 */
function renderDiagram(source: string): string | null {
  try {
    return renderMermaidSVG(source, {
      accent: 'var(--basis-color-primary)',
      bg: 'var(--basis-color-background)',
      border: 'var(--basis-color-primary)',
      fg: 'var(--basis-color-foreground)',
      font: FONT,
      padding: 16,
      transparent: true,
    })
  } catch {
    return null
  }
}

/**
 * Renders a Mermaid diagram with the `beautiful-mermaid` renderer.
 *
 * Rendering is synchronous and DOM-free, so server rendering emits the final
 * SVG — there is no lazy runtime, no client bootstrap, and no network at
 * render time. The diagram is painted from the surrounding Basis design tokens,
 * so it follows the active `Theme`; there is no Mermaid-specific theme API in
 * Basis. Put the diagram in a named `Theme` scope (the component's `theme` prop
 * sets `data-theme`) to restyle it.
 */
export class Mermaid extends Component<Props, HTMLDivElement> {
  static displayName = 'MermaidDiagram'
  static defaultProps: Props = { children: undefined }

  /**
   * The diagram source, from the element's text children.
   * @returns The diagram source.
   */
  get source(): string {
    return React.Children.toArray(this.props.children).join('').trim()
  }

  override content(): React.ReactNode {
    const svg = renderDiagram(this.source)
    if (svg) return <div className="diagram" dangerouslySetInnerHTML={{ __html: svg }} />
    return <pre className="mermaid">{this.source}</pre>
  }
}
