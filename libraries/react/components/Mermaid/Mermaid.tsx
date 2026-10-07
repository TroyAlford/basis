import * as React from 'react'
import { Component } from '../Component/Component'
import type { MermaidConfig, MermaidVariant } from './theme'
import { mermaidConfig, readMermaidTokens } from './theme'

import './Mermaid.styles.ts'

/** Source of the lazily loaded Mermaid runtime. */
export const MERMAID_SOURCE = 'https://esm.sh/mermaid@11'

interface Props {
  /** Mermaid diagram source. */
  children?: React.ReactNode,
  /** The named look applied to the diagram. Defaults to `basis`. */
  variant?: MermaidVariant,
}

interface State {
  /** The rendered SVG, once the runtime has run. */
  svg: string | null,
}

/** The slice of the Mermaid runtime the component uses. */
interface MermaidRuntime {
  /** Apply a configuration before the next render. */
  initialize: (config: MermaidConfig) => void,
  /** Render diagram source to SVG. */
  render: (id: string, source: string) => Promise<{ svg: string }>,
}

let sequence = 0
let runtime: Promise<MermaidRuntime> | null = null

/*
 * Mermaid's theme lives in module-global configuration, and `initialize` must
 * sit immediately before the `render` it applies to. A module-level promise
 * chain serialises each initialize/render pair, so several diagrams — including
 * diagrams with different variants — render with the configuration intended for
 * them rather than whichever mounted last.
 */
let queue: Promise<unknown> = Promise.resolve()

/**
 * Load the Mermaid runtime, once per document.
 * @returns The runtime.
 */
function loadRuntime(): Promise<MermaidRuntime> {
  runtime ??= import(MERMAID_SOURCE).then((module: { default: MermaidRuntime }) => module.default)
  return runtime
}

/**
 * Render a diagram to SVG, serialised behind every other in-flight render.
 * @param id - The element id Mermaid renders into.
 * @param source - The diagram source.
 * @param config - The Mermaid configuration.
 * @returns The rendered SVG.
 */
function renderDiagram(id: string, source: string, config: MermaidConfig): Promise<string> {
  const result = queue.then(async () => {
    const mermaid = await loadRuntime()
    mermaid.initialize({ startOnLoad: false, ...config })
    const { svg } = await mermaid.render(id, source)
    return svg
  })
  queue = result.then(() => undefined, () => undefined)
  return result
}

/**
 * Renders a Mermaid diagram. The runtime is imported lazily on mount, so a page
 * that does not use diagrams never fetches it and server rendering never
 * reaches the network: SSR emits the source as the runtime's `<pre
 * class="mermaid">` block, and the client replaces it with the rendered SVG.
 *
 * The diagram is themed from the surrounding Basis design tokens, so it follows
 * the active `Theme` rather than Mermaid's stock palette. Use `variant` to pick
 * one of the named looks.
 */
export class Mermaid extends Component<Props, HTMLDivElement, State> {
  static displayName = 'MermaidDiagram'
  static defaultProps: Props = { children: undefined, variant: 'basis' }
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

  override get attributes() {
    return {
      ...super.attributes,
      'data-variant': this.props.variant,
    }
  }

  async componentDidMount(): Promise<void> {
    const tokens = readMermaidTokens(this.rootNode ?? document.documentElement)
    const config = mermaidConfig(tokens, this.props.variant)
    const svg = await renderDiagram(this.#id, this.source, config)
    await this.setState({ svg })
  }

  content(): React.ReactNode {
    const { svg } = this.state
    if (svg) return <div className="diagram" dangerouslySetInnerHTML={{ __html: svg }} />
    return <pre className="mermaid">{this.source}</pre>
  }
}
