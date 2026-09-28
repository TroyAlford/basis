import * as React from 'react'
import { isNil, match, noop } from '../../../utilities'
import type { IAccessible } from '../../mixins/Accessible'
import type { IFocusable } from '../../mixins/Focusable'
import type { IPlaceholder } from '../../mixins/Placeholder'
import type { IPopup } from '../../mixins/Popup'
import type { IPrefixSuffix } from '../../mixins/PrefixSuffix'
import { Keyboard } from '../../types/Keyboard'
import { Event, events } from '../../utilities/EventManager'
import { Component } from '../Component/Component'
import { Menu } from '../Menu/Menu'
import { PopupMenu } from '../PopupMenu/PopupMenu'
import { TextEditor } from '../TextEditor/TextEditor'
import { AutoCompleteStatus } from './AutoCompleteStatus'

import './AutoComplete.styles.ts'

/** Props for the AutoComplete component. */
interface Props<T = unknown>
  extends IAccessible, IPrefixSuffix, IPlaceholder, IFocusable, Omit<IPopup, 'arrow'> {
  /** Whether to automatically focus the input on mount. Defaults to `false`. */
  autoFocus?: boolean,
  /** Whether to close the dropdown when an option is selected. Defaults to `true`. */
  closeOnSelect?: boolean,
  /** Function to get the disabled state of an option. */
  getOptionDisabled?: (option: T) => boolean,
  /** Function to get the unique key for an option. */
  getOptionKey?: (option: T) => string,
  /** Function to get the display label for an option. */
  getOptionLabel: (option: T) => React.ReactNode,
  /** Function to get the value for an option. */
  getOptionValue: (option: T) => string,
  /** Minimum length of search query before triggering search. Defaults to `0`. */
  minimumQueryLength?: number,
  /** A callback function that is called when the dropdown is closed. */
  onClose?: () => void,
  /** A callback function that is called when the dropdown is opened. */
  onOpen?: () => void,
  /** A callback function that is called when the search query changes. */
  onSearch: (query: string) => Promise<T[]>,
  /** A callback function that is called when an option is selected. */
  onSelect?: (value: string, option: T) => void,
  /** Whether the dropdown is open. */
  open?: boolean,
  /** Custom render function for options. */
  optionRender?: (option: T) => React.ReactNode,
  /** Content to display when loading. */
  whenLoading?: React.ReactNode,
  /** Content to display when no results are found. */
  whenNotFound?: React.ReactNode,
}

interface State<T = unknown> {
  /** Index of the active option, or -1 when none is active. */
  activeIndex: number,
  /** Current error, if any. */
  error: Error | null,
  /** Whether a search is currently in progress. */
  loading: boolean,
  /** Whether the dropdown is open. */
  open: boolean,
  /** Available options from search. */
  options: T[],
  /** Current search query. */
  search: string,
}

/** Generic autocomplete component that combines TextEditor with PopupMenu for async search functionality. */
export class AutoComplete<T = unknown> extends Component<Props<T>, HTMLDivElement, State<T>> {
  static Status = AutoCompleteStatus

  static displayName = 'AutoComplete'

  static #nextId = 0

  static get defaultProps() {
    return {
      ...super.defaultProps,
      autoFocus: false,
      closeOnSelect: true,
      minLength: 0,
      onClose: noop,
      onOpen: noop,
    }
  }

  readonly #id = `basis:auto-complete:${AutoComplete.#nextId++}`

  private input = React.createRef<TextEditor>()
  private debounceTimeout?: ReturnType<typeof setTimeout>
  private searchCounter = 0
  private unsubscribeBlur?: () => void

  get attributes() {
    return {
      ...super.attributes,
      'data-loading': this.state.loading,
      'data-open': this.isOpen,
    }
  }

  get defaultState(): State<T> {
    return {
      ...super.defaultState,
      activeIndex: -1,
      error: null,
      loading: false,
      open: this.props.open ?? false,
      options: [],
      search: '',
    }
  }

  get isOpen(): boolean {
    return isNil(this.props.open)
      ? !!this.state.open
      : !!this.props.open
  }

  /**
   * Unique id for this component's listbox.
   * @returns The listbox id.
   */
  get listboxId(): string { return `${this.#id}:listbox` }

  /**
   * The id of the active option, for the combobox input's
   * `aria-activedescendant`.
   * @returns The active option id, or undefined when no option is active.
   */
  get activeDescendantId(): string | undefined {
    const { activeIndex, options } = this.state
    return this.isOpen && activeIndex >= 0 && options.length > 0
      ? this.optionId(activeIndex)
      : undefined
  }

  get tag(): keyof React.JSX.IntrinsicElements { return 'div' }

  /**
   * The unique id for an option at an index.
   * @param index - The option index.
   * @returns The option id.
   */
  optionId(index: number): string { return `${this.#id}:option:${index}` }

  override componentDidMount(): void {
    super.componentDidMount()
    this.unsubscribeBlur = events.on(Event.Blur, this.rootNode, this.handleClose)
  }

  override componentWillUnmount(): void {
    super.componentWillUnmount()
    this.unsubscribeBlur?.()
    clearTimeout(this.debounceTimeout)
  }

  private handleClose = (): void => {
    this.setState({ activeIndex: -1, open: false }, () => this.props.onClose())
  }

  private handleInputChange = async (search: string): Promise<void> => {
    await this.setState({ activeIndex: -1, search })

    if (search.length >= (this.props.minimumQueryLength ?? 0)) {
      clearTimeout(this.debounceTimeout)
      this.debounceTimeout = setTimeout(async () => {
        const searchId = ++this.searchCounter
        await this.setState({ loading: true })

        try {
          const options = await this.props.onSearch(search)

          // Only update if this is still the most recent search
          if (this.searchCounter === searchId) {
            await this.setState({ activeIndex: -1, loading: false, open: true, options })
            this.props.onOpen()
          }
        } catch (error) {
          // Only update if this is still the most recent search
          if (this.searchCounter === searchId) {
            if (error instanceof Error) {
              await this.setState({ activeIndex: -1, error, loading: false })
            } else {
              await this.setState({ activeIndex: -1, loading: false })
            }
          }
        }
      }, 250)
    } else {
      await this.setState({ activeIndex: -1, open: false, options: [] })
    }
  }

  private handleFocus = (): void => {
    // Open dropdown if we have a search query (to show "No results" or existing results)
    if (this.state.search.length >= (this.props.minimumQueryLength ?? 0)) {
      this.setState({ open: true }, () => this.props.onOpen())
    }
  }

  protected handleTextEditorKeyDown = (event: React.KeyboardEvent<HTMLElement>): boolean => {
    if (event.defaultPrevented) return

    match(event.key)
      .when(Keyboard.ArrowDown).then(() => {
        event.preventDefault()
        this.moveActiveOption(1)
      })
      .when(Keyboard.ArrowUp).then(() => {
        event.preventDefault()
        this.moveActiveOption(-1)
      })
      .when(Keyboard.Enter).then(() => {
        if (this.state.activeIndex < 0) return
        event.preventDefault()
        this.activateActiveOption()
      })
      .when(Keyboard.Escape).then(() => {
        event.preventDefault()
        this.handleClose()
      })
  }

  protected handleMenuKeyDown = (event: React.KeyboardEvent<HTMLElement>): boolean => (
    match(event.key)
      .when(Keyboard.Escape).then(() => {
        event.preventDefault()
        this.handleClose()
        return true
      })
      .else(false)
  )

  /**
   * Move the active option, keeping DOM focus on the combobox input.
   * @param delta - `1` for the next option, `-1` for the previous.
   */
  private moveActiveOption = (delta: number): void => {
    const count = this.state.options.length
    if (count === 0) return

    const current = this.state.activeIndex
    const next = current < 0
      ? (delta > 0 ? 0 : count - 1)
      : (current + delta + count) % count

    this.setActiveIndex(next)
  }

  /**
   * Activate the currently active option, if any.
   *
   * A disabled option may become active, but is never activated, matching the
   * disabled guard that `Menu.Item` applies to pointer/menu-item activation.
   */
  private activateActiveOption = (): void => {
    const { activeIndex, options } = this.state
    const option = options[activeIndex]
    if (option === undefined) return
    if (this.props.getOptionDisabled?.(option) ?? false) return

    this.handleSelect(option)
  }

  /**
   * Track the active option for `aria-activedescendant`.
   * @param index - The option index, or -1 when none is active.
   */
  private setActiveIndex = (index: number): void => {
    void this.setState({ activeIndex: index })
  }

  private handleSelect = (option: T): void => {
    const value = this.props.getOptionValue(option)

    this.setState({ search: value }, () => {
      this.props.onSelect?.(value, option)
      if (this.props.closeOnSelect) {
        this.handleClose()
      }
    })
  }

  content(): React.ReactNode {
    const {
      autoFocus,
      className,
      disabled,
      getOptionDisabled,
      getOptionKey,
      getOptionLabel,
      invalid,
      label,
      optionRender,
      placeholder,
      prefix,
      readOnly,
      suffix,
      whenLoading: loadingContent,
      whenNotFound: notFoundContent,
    } = this.props

    const { error, loading, options } = this.state
    const hasOptions = (options ?? []).length > 0

    const menuItems = (options ?? []).map((option, index) => {
      const key = getOptionKey?.(option) ?? String(index)
      const optionDisabled = getOptionDisabled?.(option) ?? false

      return (
        <Menu.Item
          key={key}
          disabled={optionDisabled}
          id={this.optionId(index)}
          role="option"
          selected={index === this.state.activeIndex}
          tabIndex={-1}
          onActivate={() => this.handleSelect(option)}
          onFocus={() => this.setActiveIndex(index)}
        >
          {optionRender?.(option) ?? getOptionLabel(option)}
        </Menu.Item>
      )
    })

    let content: React.ReactNode

    if (loading) {
      content = loadingContent ?? <div data-state={AutoCompleteStatus.Loading}>Loading...</div>
    } else if (error) {
      content = <div data-state={AutoCompleteStatus.Error}>Error: {error.message}</div>
    } else if (!hasOptions) {
      content = notFoundContent ?? <div data-state={AutoCompleteStatus.NotFound}>No results found</div>
    } else {
      content = menuItems
    }

    return (
      <>
        <TextEditor
          ref={this.input}
          selectOnFocus
          autoFocus={autoFocus}
          className={className}
          disabled={disabled}
          invalid={invalid}
          label={label}
          placeholder={placeholder}
          prefix={prefix}
          readOnly={readOnly}
          suffix={suffix}
          value={this.state.search}
          inputAttributes={{
            'aria-activedescendant': this.activeDescendantId,
            'aria-autocomplete': 'list',
            'aria-controls': this.isOpen && hasOptions ? this.listboxId : undefined,
            'aria-expanded': this.isOpen,
            'role': 'combobox',
          }}
          onChange={this.handleInputChange}
          onFocus={this.handleFocus}
          onKeyDown={this.handleTextEditorKeyDown}
        />
        {this.isOpen && (
          <PopupMenu
            constrainHeight
            sameWidth
            anchorPoint={this.props.anchorPoint}
            anchorTo={this.input.current?.rootNode}
            disabled={this.props.disabled}
            id={hasOptions ? this.listboxId : undefined}
            offset={this.props.offset}
            role={hasOptions ? 'listbox' : 'presentation'}
            onKeyDown={this.handleMenuKeyDown}
          >
            {content}
          </PopupMenu>
        )}
      </>
    )
  }
}
