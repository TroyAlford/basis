import * as React from 'react'
import { AbortablePromise, isNil, match, noop } from '@basis/utilities'
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

import './AutoComplete.styles.ts'

/** Props for the AutoComplete component. */
interface Props<T = unknown>
  extends IAccessible, IPrefixSuffix, IPlaceholder, IFocusable, Omit<IPopup, 'arrow'> {
  /** Whether to automatically focus the input on mount. @default false */
  autoFocus?: boolean,
  /** Whether to close the dropdown when an option is selected. @default true */
  closeOnSelect?: boolean,
  /** Function to get the disabled state of an option. */
  getOptionDisabled?: (option: T) => boolean,
  /** Function to get the unique key for an option. */
  getOptionKey?: (option: T) => string,
  /** Function to get the display label for an option. */
  getOptionLabel: (option: T) => React.ReactNode,
  /** Function to get the value for an option. */
  getOptionValue: (option: T) => string,
  /** Minimum length of search query before triggering search. @default 0 */
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
  static displayName = 'AutoComplete'

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

  private input = React.createRef<TextEditor>()
  private debounceTimeout?: ReturnType<typeof setTimeout>
  private searching?: AbortablePromise<T[]>
  private unsubscribeBlur?: () => void

  get attributes() {
    return {
      ...super.attributes,
      'aria-expanded': this.isOpen,
      'aria-haspopup': 'listbox',
      'data-loading': this.state.loading,
      'data-open': this.isOpen,
    }
  }

  get defaultState(): State<T> {
    return {
      ...super.defaultState,
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

  get tag(): keyof React.JSX.IntrinsicElements { return 'div' }

  override componentDidMount(): void {
    super.componentDidMount()
    this.unsubscribeBlur = events.on(Event.Blur, this.rootNode, this.handleClose)
  }

  override componentWillUnmount(): void {
    super.componentWillUnmount()
    this.unsubscribeBlur?.()
    this.searching?.abort()
    clearTimeout(this.debounceTimeout)
  }

  private handleClose = (): void => {
    this.setState({ open: false }, () => this.props.onClose())
  }

  private handleInputChange = async (search: string): Promise<void> => {
    await this.setState({ search })

    if (search.length >= (this.props.minimumQueryLength ?? 0)) {
      clearTimeout(this.debounceTimeout)
      this.debounceTimeout = setTimeout(async () => {
        // Abort any previous search
        this.searching?.abort()

        await this.setState({ loading: true })

        // Create abortable promise with 5 second timeout for search operations
        this.searching = new AbortablePromise<T[]>((resolve, reject) => {
          const searchPromise = this.props.onSearch(search)
          if (searchPromise && typeof searchPromise.then === 'function') {
            searchPromise.then(resolve).catch(reject)
          } else {
            reject(new Error('onSearch must return a Promise'))
          }
        }, { timeout: 5000 })

        try {
          const options = await this.searching
          await this.setState({ loading: false, open: true, options })
          this.props.onOpen()
        } catch (error) {
          if (error instanceof Error && error.name !== 'AbortError') {
            await this.setState({ error, loading: false })
          }
        }
      }, 250)
    } else {
      await this.setState({ open: false, options: [] })
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
        this.focusFirstMenuItem()
      })
      .when(Keyboard.ArrowUp).then(() => {
        event.preventDefault()
        this.focusLastMenuItem()
      })
      .when(Keyboard.Escape).then(() => {
        event.preventDefault()
        this.handleClose()
      })
  }

  protected handleMenuKeyDown = (event: React.KeyboardEvent<HTMLElement>): boolean => (
    match(event.key)
      .when(Keyboard.Escape).then(() => {
        const input = this.input.current?.input.current
        input?.focus()
        input?.select()
        return true
      })
      .else(false)
  )

  get menuItems(): HTMLLIElement[] {
    const menuItems = this.rootNode.querySelectorAll<HTMLLIElement>('.menu-item.component')
    return Array.from<HTMLLIElement>(menuItems) ?? []
  }

  private focusFirstMenuItem = (): void => {
    const menuItems = this.menuItems
    menuItems[0]?.focus()
  }

  private focusLastMenuItem = (): void => {
    const menuItems = this.menuItems
    menuItems[menuItems.length - 1]?.focus()
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

    const menuItems = (options ?? []).map((option, index) => {
      const key = getOptionKey?.(option) ?? String(index)
      const optionDisabled = getOptionDisabled?.(option) ?? false

      return (
        <Menu.Item
          key={key}
          disabled={optionDisabled}
          onActivate={() => this.handleSelect(option)}
        >
          {optionRender?.(option) ?? getOptionLabel(option)}
        </Menu.Item>
      )
    })

    let content: React.ReactNode = null

    if (loading) {
      content = loadingContent ?? <div className="loading">Loading...</div>
    } else if (error) {
      content = <div className="error">Error: {error.message}</div>
    } else if ((options ?? []).length === 0) {
      content = notFoundContent ?? <div className="not-found">No results found</div>
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
          onChange={this.handleInputChange}
          onFocus={this.handleFocus}
          onKeyDown={this.handleTextEditorKeyDown}
        />
        {this.isOpen && (
          <PopupMenu
            anchorPoint={this.props.anchorPoint}
            anchorTo={this.input.current?.rootNode}
            disabled={this.props.disabled}
            offset={this.props.offset}
            onKeyDown={this.handleMenuKeyDown}
          >
            {content}
          </PopupMenu>
        )}
      </>
    )
  }
}
