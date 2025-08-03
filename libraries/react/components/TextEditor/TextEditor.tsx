import * as React from 'react'
import type { IAccessible } from '../../mixins/Accessible'
import { Accessible } from '../../mixins/Accessible'
import type { IPlaceholder } from '../../mixins/Placeholder'
import { Placeholder } from '../../mixins/Placeholder'
import type { IPrefixSuffix } from '../../mixins/PrefixSuffix'
import { PrefixSuffix } from '../../mixins/PrefixSuffix'
import { applyMixins } from '../../utilities/applyMixins'
import { Editor } from '../Editor/Editor'

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
  /** Whether the text editor should render as a textarea for multi-line input. @default false */
  multiline?: boolean,
  /** Callback function called when a key is pressed while the input has focus. */
  onKeyDown?: (event: React.KeyboardEvent<HTMLElement>) => void,
  /** Whether the textarea can be resized by the user (only applies when multiline is true). @default true */
  resizable?: boolean,
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
    resizable: true,
    wrap: Wrap.Soft,
  }

  #handleChange = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    this.handleChange(event.target.value)
  }

  /**
   * Renders the component's content in read-only mode.
   * @returns The component's content as text with newlines converted to <br /> tags.
   */
  readOnly(): React.ReactNode {
    const value = String(this.current ?? '')

    // For multiline text, replace newlines with <br /> tags
    if (this.props.multiline) {
      const lines = value.split('\n')
      return lines.map((line, index) => (
        <React.Fragment key={index}>
          {line}
          {index < lines.length - 1 && <br />}
        </React.Fragment>
      ))
    }

    return value
  }

  /**
   * Renders the component's content.
   * @returns The component's content.
   */
  content(): React.ReactNode {
    const input: React.ReactElement<React.HTMLAttributes<HTMLElement>> = this.props.multiline ? (
      <textarea
        autoComplete={this.props.autoComplete ? 'on' : 'off'}
        style={this.props.resizable ? undefined : { resize: 'none' }}
        value={this.current || ''}
        wrap={this.props.wrap}
        onChange={this.#handleChange}
        onKeyDown={this.props.onKeyDown}
      />
    ) : (
      <input
        autoComplete={this.props.autoComplete ? 'on' : 'off'}
        type="text"
        value={this.current || ''}
        onChange={this.#handleChange}
        onKeyDown={this.props.onKeyDown}
      />
    )
    const rendered = applyMixins(input, this, [Accessible, PrefixSuffix, Placeholder])

    return super.content(rendered)
  }
}
