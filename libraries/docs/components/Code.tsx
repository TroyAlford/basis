import { Await, Component } from 'basis/react'

import './Code.styles.ts'

interface Props {
  code: string,
  language: string,
  theme: string,
}

/** The locally pinned Shiki runtime surface. */
interface Shiki {
  /** Highlight source to Shiki HTML. */
  codeToHtml: (code: string, options: { lang: string, theme: string }) => Promise<string>,
}

/** The Shiki runtime, loaded at most once per document. */
let runtime: Promise<Shiki> | null = null

/** Highlighted HTML keyed by theme, language, and source. */
const highlighted = new Map<string, string>()

/**
 * Load the installed Shiki runtime, once per document.
 * @returns The runtime.
 */
function loadShiki(): Promise<Shiki> {
  runtime ??= import('shiki')
  return runtime
}

/**
 * Highlight source to Shiki HTML in the browser.
 * @param code - Source to highlight.
 * @param language - Shiki language id.
 * @param theme - Shiki theme id.
 * @returns Highlighted HTML, or null when no document is available.
 */
export async function highlight(
  code: string,
  language = 'tsx',
  theme = 'github-dark-high-contrast',
): Promise<string | null> {
  if (typeof globalThis.document === 'undefined') return null
  const key = `${theme}\u0000${language}\u0000${code}`
  const cached = highlighted.get(key)
  if (cached !== undefined) return cached
  const { codeToHtml } = await loadShiki()
  const html = await codeToHtml(code, { lang: language, theme })
  highlighted.set(key, html)
  return html
}

export class Code extends Component<Props> {
  static displayName = 'Code'
  static defaultProps: Props = {
    code: '',
    language: 'tsx',
    theme: 'github-dark-high-contrast',
  }
  static format = (
    code: string,
    language = 'tsx',
    theme = 'github-dark-high-contrast',
  ) => <Code code={code} language={language} theme={theme} />

  override get attributes() {
    return {
      ...super.attributes,
      'data-code-language': this.props.language,
      'data-code-theme': this.props.theme,
    }
  }

  override content() {
    return super.content(
      <Await fallback={<code>{this.code}</code>}>
        {this.renderCode()}
      </Await>,
    )
  }

  get code(): string {
    if (typeof this.props.code !== 'string') return ''

    const lines = this.props.code
      .replace(/\t/g, '  ')
      .split('\n')

    const firstLine = lines.find(line => line.trim() !== '')
    if (firstLine === undefined) {
      return this.props.code.trim()
    }

    const [, indentation = ''] = firstLine.match(/^(\s*)/) || []

    return lines.map(line => line.slice(indentation.length))
      .join('\n')
      .trim()
  }

  async renderCode() {
    const html = await highlight(this.code, this.props.language, this.props.theme)
    return html === null
      ? <code>{this.code}</code>
      : <code dangerouslySetInnerHTML={{ __html: html }} />
  }
}
