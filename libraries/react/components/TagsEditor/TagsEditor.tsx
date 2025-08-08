import * as React from 'react'
import { deburr } from '@basis/utilities'
import { css, style } from '../../utilities/style'
import { Editor } from '../Editor/Editor'
import { Tag } from '../Tag/Tag'
import { TextEditor } from '../TextEditor/TextEditor'

/** Props for the TagsEditor component. */
interface Props {
  /** List of tags to deny from being added. */
  denyList?: string[],
  /** Icon to display before the input. */
  icon?: React.ReactNode,
  /** Placeholder text for the input. */
  placeholder?: string,
  /** Function to render a tag. */
  tag?: (tag: string) => React.ReactNode,
}

/** State for the TagsEditor component. */
interface State {
  /** Current input value. */
  inputValue: string,
}

/** TagsEditor component that allows adding and removing tags. */
export class TagsEditor extends Editor<string[], HTMLDivElement, Props, State> {
  static displayName = 'TagsEditor'

  /** Default props for tags editor. */
  static defaultProps = {
    ...Editor.defaultProps,
    denyList: [],
    icon: null,
    placeholder: 'Add...',
    tag: null,
  }

  get defaultState(): State & Editor<string[]>['state'] {
    return {
      ...super.defaultState,
      inputValue: '',
    }
  }

  /**
   * Ensure current value is always an array for rendering/logic safety.
   * @returns the current tags array (defaults to [])
   */
  override get current(): string[] {
    const value = super.current
    return Array.isArray(value) ? value : []
  }

  /** Reference to the text editor. */
  private textEditor = React.createRef<TextEditor>()

  /**
   * Converts a string to a slug-like format.
   * @param text The text to convert.
   * @returns The slugified text.
   */
  private slugify(text: string): string {
    return deburr(text)
      .replace(/([^a-z0-9:]|\b)+/ig, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-:-/g, ':')
      .toLowerCase()
  }

  /**
   * Removes duplicates from an array.
   * @param array The array to remove duplicates from.
   * @returns The array with duplicates removed.
   */
  private unique<T>(array: T[]): T[] {
    return Array.from(new Set(array))
  }

  /**
   * Handles adding a new tag.
   * @param value The value to add.
   */
  private handleAdd(value: string): void {
    const trimmed = value && value.trim()
    if (!trimmed || (this.props.denyList && this.props.denyList.includes(trimmed))) {
      return
    }

    const currentTags = this.current || []
    const newTags = this.unique([...currentTags, trimmed].map(this.slugify)).sort()
    this.handleChange(newTags)

    // Clear input
    this.setState({ inputValue: '' })
  }

  /**
   * Handles input change.
   * @param value The new value.
   */
  private handleInputChange = (value: string): void => {
    this.setState({ inputValue: value })
  }

  /**
   * Handles key down events.
   * @param event The event object.
   * @returns True if the event was handled, false otherwise.
   */
  override handleKeyDown: TextEditor['props']['onKeyDown'] = event => {
    switch (event.key) {
      case 'Backspace':
        if (event.target.value === '') {
          event.preventDefault()
          this.handleRemove(this.current[this.current.length - 1])
        }
        return true

      case 'Enter':
        event.preventDefault()
        this.handleAdd(event.target.value)
        return true

      case 'Escape':
        this.setState({ inputValue: '' })
        return true

      default:
        super.handleKeyDown(event)
        return !event.defaultPrevented
    }
  }

  /**
   * Handles removing a tag.
   * @param tagToRemove The tag to remove.
   */
  private handleRemove = (tagToRemove: string): void => {
    const newTags = (this.current || []).filter(tag => tag !== tagToRemove)
    this.handleChange(newTags)
  }

  get attributes() {
    return {
      ...super.attributes,
      'data-readonly': this.props.readOnly,
    }
  }

  renderTag = (value: string): React.ReactNode => (
    typeof this.props.tag === 'function' ? this.props.tag(value) : (
      <Tag
        key={value}
        removable={!this.props.readOnly}
        onRemove={() => this.handleRemove(value)}
      >
        {value}
      </Tag>
    )
  )

  override content(): React.ReactNode {
    const { icon, placeholder, readOnly } = this.props
    const { inputValue } = this.state

    return super.content(
      <>
        <div className="tags">
          {this.current.map(this.renderTag)}
        </div>
        {!readOnly && (
          <TextEditor
            ref={this.textEditor}
            autoFocus
            placeholder={placeholder}
            prefix={icon}
            value={inputValue}
            onChange={this.handleInputChange}
            onKeyDown={this.handleKeyDown}
          />
        )}
      </>,
    )
  }

  override readOnly() {
    return (
      <div className="tags">
        {this.current.map(this.renderTag)}
      </div>
    )
  }
}

style('basis:tags-editor', css`
  .tags-editor {
    display: flex;
    flex-direction: column;
    gap: .1em;
    padding: .1em;

    > .tags {
      display: inline-flex;
      flex-wrap: wrap;
      gap: .1em;
    }

    > .text-editor {
      min-width: 10ch;
    }
  }
`)
