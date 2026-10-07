import { Await, Component } from 'basis/react'

import './Code.styles.ts'

interface Props {
  code: string,
  language: string,
  theme: string,
}

/** The Shiki runtime surface this component uses. */
interface Shiki {
  /** Highlight `code` to Shiki HTML. */
  codeToHtml: (code: string, options: { lang: string, theme: string }) => Promise<string>,
}

/** The Shiki runtime, loaded at most once per document. */
let runtime: Promise<Shiki> | null = null

/**
 * Load the Shiki runtime, once per document.
 * @returns The runtime.
 */
function loadShiki(): Promise<Shiki> {
  // @ts-expect-error - the runtime is loaded from a URL, not a package.
  // eslint-disable-next-line @basis/import-extensions
  runtime ??= import('https://esm.sh/shiki@3.0.0')
  return runtime
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
    if (typeof globalThis.document === 'undefined') return <code>{this.code}</code>
    const { codeToHtml } = await loadShiki()
    const html = await codeToHtml(this.code, {
      lang: this.props.language,
      theme: this.props.theme,
    })

    return <code dangerouslySetInnerHTML={{ __html: html }} />
  }
}
