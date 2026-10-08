import { Component } from 'basis/react'
import * as React from 'react'

import './BeautifulMermaid.styles.ts'

/** Source of the lazily loaded beautiful-mermaid runtime. */
export const BEAUTIFUL_MERMAID_SOURCE = 'https://esm.sh/beautiful-mermaid@1.1.3'

/** The slice of the beautiful-mermaid runtime this component uses. */
interface BeautifulRuntime {
  /** Render Mermaid source to an SVG string. */
  renderMermaidSVG: (text: string, options?: Record<string, unknown>) => string,
}

interface Props {
  /** Mermaid diagram source. */
  children?: React.ReactNode,
}

interface State {
  /** The error message, when rendering failed. */
  error: string | null,
  /** The rendered SVG, once the runtime has run. */
  svg: string | null,
}

let runtime: Promise<BeautifulRuntime> | null = null

/**
 * Load the beautiful-mermaid runtime, once per document.
 * @returns The runtime.
 */
function loadRuntime(): Promise<BeautifulRuntime> {
  runtime ??= import(BEAUTIFUL_MERMAID_SOURCE)
  return runtime
}

/**
 * Renders a diagram with `beautiful-mermaid`, for comparison against
 * {@link Mermaid} in the documentation app. Not part of the published surface:
 * it exists so the two renderers can be reviewed side by side.
 */
export class BeautifulMermaid extends Component<Props, HTMLDivElement, State> {
  static displayName = 'BeautifulMermaid'
  static defaultProps: Props = { children: undefined }

  get defaultState(): State {
    return { error: null, svg: null }
  }

  /**
   * The diagram source, from the element's text children.
   * @returns The diagram source.
   */
  get source(): string {
    return React.Children.toArray(this.props.children).join('').trim()
  }

  async componentDidMount(): Promise<void> {
    try {
      const { renderMermaidSVG } = await loadRuntime()
      /*
       * Pass the Basis tokens as CSS variables so the SVG inherits the active
       * theme the same way the Mermaid component does.
       */
      const svg = renderMermaidSVG(this.source, {
        accent: 'var(--basis-color-primary)',
        bg: 'var(--basis-color-background)',
        fg: 'var(--basis-color-foreground)',
        font: "'Ubuntu', sans-serif",
        transparent: true,
      })
      await this.setState({ svg })
    } catch (error) {
      await this.setState({ error: error instanceof Error ? error.message : String(error) })
    }
  }

  content(): React.ReactNode {
    const { error, svg } = this.state
    if (svg) return <div className="diagram" dangerouslySetInnerHTML={{ __html: svg }} />
    if (error) return <pre>{error}</pre>
    return <pre>{this.source}</pre>
  }
}
