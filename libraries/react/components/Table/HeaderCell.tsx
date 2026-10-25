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

export class HeaderCell<TRow, TField extends PathOf<TRow>>
  extends Editor<ColumnProps<TRow, TField>, HTMLTableCellElement, ColumnProps<TRow, TField>> {
  static displayName = 'Table.HeaderCell'
  static get mixins(): Set<Mixin> {
    return super.mixins.add(Pinnable)
  }

  get attributes() {
    const { headerContent, sortable, sortDirection } = this.current
    return {
      ...super.attributes,
      'aria-label': headerContent === undefined || headerContent === null ? undefined : this.displayTitle,
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

  private get displayTitle(): string {
    const { field, title } = this.current
    return title || String(field)
  }

  private get ariaSort(): 'ascending' | 'descending' | 'none' {
    switch (this.current.sortDirection) {
      case SortDirection.Asc: return 'ascending'
      case SortDirection.Desc: return 'descending'
      default: return 'none'
    }
  }

  private handleSort = () => {
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

    // @ts-expect-error - some error in TypeAt? Not sure yet
    this.handleField(direction, 'sortDirection')
  }

  /**
   * Sort from the keyboard without letting an interactive control inside
   * `headerContent` trigger the column's sort.
   * @param event - The keydown event on the header cell.
   */
  private handleSortKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    this.props.onKeyDown?.(event)
    if (event.defaultPrevented || !this.current.sortable) return
    if (event.key !== Keyboard.Enter && event.key !== Keyboard.Space) return

    event.preventDefault()
    this.handleSort()
  }

  /**
   * Keep pointer and keyboard events from an interactive header control out of
   * the header cell's own sort handling.
   * @param event - The event bubbling from the header content.
   */
  private stopHeaderContentPropagation = (event: React.SyntheticEvent): void => {
    event.stopPropagation()
  }

  private get header(): React.ReactNode {
    const { headerContent } = this.current
    if (headerContent === undefined || headerContent === null) {
      return <span className="title">{this.displayTitle}</span>
    }

    return (
      <div
        className="header-content"
        onClick={this.stopHeaderContentPropagation}
        onKeyDown={this.stopHeaderContentPropagation}
      >
        {headerContent}
      </div>
    )
  }

  content(): React.ReactNode {
    const { sortable, sortDirection } = this.current

    return super.content(
      <div className="content">
        {this.header}
        {sortable && (
          <Sort
            aria-label={`Sort by ${this.displayTitle}`}
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
