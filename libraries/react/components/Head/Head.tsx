import * as React from 'react'
import { Component } from '../Component/Component'

/** Collects page-head updates while rendering on the server. */
export interface HeadCollector {
  title?: string,
}

interface HeadContextValue {
  collector?: HeadCollector,
  setTitle: (title: string) => void,
}

const HeadContext = React.createContext<HeadContextValue | null>(null)

interface HeadProviderProps {
  children?: React.ReactNode,
  collector?: HeadCollector,
}

/**
 * Provides page-head updates to the application tree.
 *
 * On the server, a collector receives the title for the shell. In the browser,
 * the same component updates `document.title` after commit.
 */
export class HeadProvider extends Component<HeadProviderProps> {
  #value: HeadContextValue = {
    collector: this.props.collector,
    setTitle: (title: string): void => {
      if (this.props.collector) this.props.collector.title = title
      if (typeof document !== 'undefined') document.title = title
    },
  }

  override render(): React.ReactNode {
    return (
      <HeadContext.Provider value={this.#value}>
        {this.props.children}
      </HeadContext.Provider>
    )
  }
}

/**
 * Sets the current page title. Renders nothing.
 */
export class Head extends Component<{ title?: string }> {
  static contextType = HeadContext
  declare context: React.ContextType<typeof HeadContext>

  componentDidMount(): void {
    super.componentDidMount()
    if (typeof document !== 'undefined' && this.props.title) {
      this.context?.setTitle(this.props.title)
    }
  }

  override componentDidUpdate(): void {
    if (typeof document !== 'undefined' && this.props.title) {
      this.context?.setTitle(this.props.title)
    }
  }

  override render(): React.ReactNode {
    if (this.context?.collector && this.props.title) {
      this.context.setTitle(this.props.title)
    }
    return null
  }
}
