import * as React from 'react'
import type { IAccessible } from '../../mixins/Accessible'
import { Accessible } from '../../mixins/Accessible'
import type { IPlaceholder } from '../../mixins/Placeholder'
import { Placeholder } from '../../mixins/Placeholder'
import type { IPrefixSuffix } from '../../mixins/PrefixSuffix'
import { PrefixSuffix } from '../../mixins/PrefixSuffix'
import { applyMixins } from '../../utilities/applyMixins'
import { Editor } from '../Editor/Editor'

import './TextEditor.styles.ts'

/** Text wrapping options for textarea elements. */
export enum Wrap {
  /** Text wraps at character boundaries. */
  Hard = 'hard',
  /** Text does not wrap. */
  Off = 'off',
  /** Text wraps at word boundaries. */
  Soft = 'soft',
}

/** Props specific to text editor. */
interface Props extends IAccessible, IPrefixSuffix, IPlaceholder {
  /** Whether to enable browser autocomplete. */
  autoComplete?: boolean,
  /** Whether to automatically focus the input on mount. @default false */
  autoFocus?: boolean,
  /**
   * Multiline behavior for the text editor.
   *
   * - `false`: Default. Outputs an `input[type="text"]`
   * - `true`: Outputs a `textarea` with normal resizing and `data-multiline="true"`
   * - `'auto'`: Outputs `data-multiline="auto"` with auto-growing textarea
   * - `number`: Sets fixed number of lines, non-resizable textarea
   * @default false
   */
  multiline?: false | true | 'auto' | number,
  /** Callback function called when a key is pressed while the input has focus. */
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void,
  /** Whether to select all text when the input receives focus. @default true */
  selectOnFocus?: boolean,
  /** Whether to wrap text in the textarea (only applies when multiline is true). @default Wrap.Soft */
  wrap?: Wrap,
}

/** Text input editor component that extends the Editor base class. */
export class TextEditor extends Editor<string, HTMLInputElement | HTMLTextAreaElement, Props> {
  static displayName = 'TextEditor'
  /** Text wrapping options for textarea elements. */
  static readonly Wrap = Wrap

  /** Default props for text editor. */
  static defaultProps = {
    ...super.defaultProps,
    ...Accessible.defaultProps,
    ...PrefixSuffix.defaultProps,
    ...Placeholder.defaultProps,
    autoFocus: false,
    multiline: false,
    selectOnFocus: true,
    wrap: Wrap.Soft,
  }

  #input = React.createRef<HTMLInputElement | HTMLTextAreaElement>()

  #handleChange = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    this.handleChange(event.target.value)
  }

  #handleFocus = () => {
    if (this.props.selectOnFocus) {
      const currentElement = this.#input.current
      if (currentElement) {
        currentElement.select()
      }
    }
  }

  override get attributes() {
    return {
      ...super.attributes,
      'data-multiline': String(this.props.multiline),
      'data-value': String(this.current || ''),
    }
  }

  componentDidMount(): void {
    super.componentDidMount?.()
    if (this.props.autoFocus) {
      const currentElement = this.#input.current
      if (currentElement) {
        currentElement.focus()
      }
    }
  }

  /**
   * Renders the component's content in read-only mode.
   * @returns The component's content as text with newlines converted to <br /> tags.
   */
  readOnly(): React.ReactNode {
    const value = String(this.current ?? '')
    let rendered: React.ReactNode = value

    // For multiline text, replace newlines with <br /> tags
    if (this.props.multiline !== false) {
      const lines = value.split('\n')
      rendered = lines.map((line, index) => (
        <React.Fragment key={index}>
          {line}
          {index < lines.length - 1 && <br />}
        </React.Fragment>
      ))
    }

    return (
      <span className="value">
        {rendered}
      </span>
    )
  }

  /**
   * Renders the component's content.
   * @returns The component's content.
   */
  content(): React.ReactNode {
    const input: React.ReactElement<React.HTMLAttributes<HTMLElement>> = this.props.multiline !== false ? (
      <textarea
        ref={this.#input as React.RefObject<HTMLTextAreaElement>}
        autoComplete={this.props.autoComplete ? 'on' : 'off'}
        className="value"
        name={this.props.field}
        rows={typeof this.props.multiline === 'number' ? this.props.multiline : undefined}
        value={this.current || ''}
        wrap={this.props.wrap}
        onChange={this.#handleChange}
        onFocus={this.#handleFocus}
        onKeyDown={this.props.onKeyDown}
      />
    ) : (
      <input
        ref={this.#input as React.RefObject<HTMLInputElement>}
        autoComplete={this.props.autoComplete ? 'on' : 'off'}
        className="value"
        name={this.props.field}
        type="text"
        value={this.current || ''}
        onChange={this.#handleChange}
        onFocus={this.#handleFocus}
        onKeyDown={this.props.onKeyDown}
      />
    )
    const rendered = applyMixins(input, this, [Accessible, PrefixSuffix, Placeholder])

    return super.content(rendered)
  }
}
