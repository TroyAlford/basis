import * as React from 'react'
import { Await, Component } from '@basis/react'

import './Code.styles.ts'

interface Props {
  code: string,
  language: string,
  theme: string,
}

// @ts-expect-error - this is a valid dynamic import
// eslint-disable-next-line @import/extensions
const shiki = await import('https://esm.sh/shiki@3.0.0')

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

  override content(): React.ReactNode {
    return super.content(
      <Await fallback="Loading...">
        {this.renderCode()}
      </Await>,
    )
  }

  get code(): string {
    const lines = this.props.code
      .replace(/\t/g, '  ')
      .split('\n')

    const firstLine = lines.find(line => line.trim() !== '')
    const [, indentation = ''] = firstLine.match(/^(\s*)/) || []

    return lines.map(line => line.slice(indentation.length))
      .join('\n')
      .trim()
  }

  async renderCode(): Promise<React.ReactNode> {
    const { codeToHtml } = await shiki
    const html = await codeToHtml(this.code, {
      lang: this.props.language,
      theme: this.props.theme,
    })

    return <code dangerouslySetInnerHTML={{ __html: html }} />
  }
}
