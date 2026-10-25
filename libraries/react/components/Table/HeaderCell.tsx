import * as React from 'react'
import type { PathOf } from '../../../utilities'
import { Sort } from '../../icons/Sort'
import { Pinnable } from '../../mixins/Pinnable'
import { Keyboard } from '../../types/Keyboard'
import type { Mixin } from '../../types/Mixin'
import { SortBy } from '../../types/SortBy'
import { SortDirection } from '../../types/SortDirection'
import { Editor } from '../Editor/Editor'
import type { ColumnProps } from './Column'
import { ColumnType } from './Column'

import './HeaderCell.styles.ts'

/**
 * Native elements and explicit ARIA roles that own their own activation. A
 * click or keydown from one of these belongs to the control, not to the column
 * header's sort behavior.
 */
const INTERACTIVE_SELECTOR = [
  'a',
  'button',
  'input',
  'label',
  'select',
  'textarea',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
].join(', ')

export class HeaderCell<TRow, TField extends PathOf<TRow>>
  extends Editor<ColumnProps<TRow, TField>, HTMLTableCellElement, ColumnProps<TRow, TField>> {
  static displayName = 'Table.HeaderCell'
  static get mixins(): Set<Mixin> {
    return super.mixins.add(Pinnable)
  }

  get attributes() {
    const { sortable, sortDirection } = this.current
    return {
      ...super.attributes,
      'aria-sort': sortable ? this.ariaSort : undefined,
      'data-align': this.current.align,
      'data-field': this.current.field,
      'data-sort-direction': sortDirection || undefined,
      'data-sortable': sortable ? 'true' : 'false',
      'onClick': sortable ? this.handleSort : undefined,
      'onKeyDown': this.handleSortKeyDown,
      'style': {
        minWidth: this.current.width ?? undefined,
        width: this.current.width ?? '100%',
      },
      'tabIndex': sortable ? 0 : undefined,
    }
  }

  get tag(): keyof React.JSX.IntrinsicElements { return 'th' }

  /**
   * The declared title, or the field name as a stable textual fallback.
   * @returns The title content to render.
   */
  private get displayTitle(): React.ReactNode {
    const { field, title } = this.current
    return title === undefined || title === null || title === '' ? String(field) : title
  }

  /**
   * Whether the title carries React content rather than plain text.
   * @returns True when the title needs rich layout.
   */
  private get richTitle(): boolean {
    const { title } = this.current
    return title !== undefined && title !== null && typeof title !== 'string'
  }

  private get ariaSort(): 'ascending' | 'descending' | 'none' {
    switch (this.current.sortDirection) {
      case SortDirection.Asc: return 'ascending'
      case SortDirection.Desc: return 'descending'
      default: return 'none'
    }
  }

  /**
   * Whether an event came from a control inside the title. React events bubble
   * through the header cell, so the header must defer to the control rather
   * than suppressing the event on the way to its owner.
   * @param target - The event target.
   * @returns True when the target is, or is inside, an interactive control.
   */
  private isInteractiveTarget(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest(INTERACTIVE_SELECTOR) !== null
  }

  private handleSort = (event: React.MouseEvent<HTMLTableCellElement>): void => {
    if (this.isInteractiveTarget(event.target)) return
    this.sort()
  }

  private sort = (): void => {
    const { sortable, sortDirection } = this.current
    if (!sortable) return

    let direction: SortDirection | null = sortDirection ?? null

    // Cycle through: None -> Asc -> Desc -> None -> Asc -> Desc
    if (direction === null) {
      direction = SortDirection.Asc
    } else if (direction === SortDirection.Asc) {
      direction = SortDirection.Desc
    } else {
      direction = null
    }

    /*
     * Update only the sort declaration. `Editor.handleField` deep-clones the
     * editor value, which must not walk arbitrary React content in a title.
     */
    void this.handleChange({ ...this.current, sortDirection: direction })
  }

  /**
   * Sort from the keyboard only when the header cell itself has focus, leaving
   * Enter and Space to controls nested in a rich title.
   * @param event - The keydown event on the header cell.
   */
  private handleSortKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    this.props.onKeyDown?.(event)
    if (event.defaultPrevented || !this.current.sortable) return
    if (event.target !== event.currentTarget) return
    if (event.key !== Keyboard.Enter && event.key !== Keyboard.Space) return

    event.preventDefault()
    this.sort()
  }

  content(): React.ReactNode {
    const { sortable, sortDirection } = this.current

    return super.content(
      <div className="content">
        <span
          className="title"
          data-rich-title={this.richTitle ? '' : undefined}
        >
          {this.displayTitle}
        </span>
        {sortable && (
          <Sort
            aria-hidden="true"
            direction={sortDirection || undefined}
            sortBy={sortDirection ? this.sortBy : SortBy.None}
          />
        )}
      </div>,
    )
  }

  get sortBy(): SortBy {
    const { sortBy, type } = this.current
    if (sortBy) return sortBy

    switch (type) {
      case ColumnType.Boolean:
      case ColumnType.Date:
      case ColumnType.DateTime:
      case ColumnType.Number:
        return SortBy.Value

      case ColumnType.Enum:
      case ColumnType.Text:
        return SortBy.Name

      default:
        return SortBy.None
    }
  }
}
