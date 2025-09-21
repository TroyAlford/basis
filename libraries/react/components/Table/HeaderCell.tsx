import * as React from 'react'
import type { PathOf } from '@basis/utilities'
import { Sort } from '../../icons/Sort'
import { Pinnable } from '../../mixins/Pinnable'
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
    const { sortable } = this.current
    return {
      ...super.attributes,
      'data-align': this.current.align,
      'data-field': this.props.field,
      'data-sort-direction': this.props.sortDirection || undefined,
      'data-sortable': this.props.sortable ? 'true' : 'false',
      'onClick': sortable ? this.handleSort : undefined,
    }
  }

  get tag(): keyof React.JSX.IntrinsicElements { return 'th' }

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

  content(): React.ReactNode {
    const { field, sortable, title } = this.current
    const displayTitle = title || String(field)

    return super.content(
      <div className="content">
        <span className="title">{displayTitle}</span>
        {sortable && (
          <Sort
            aria-label={`Sort by ${displayTitle}`}
            direction={this.current.sortDirection || undefined}
            sortBy={this.current.sortDirection ? this.sortBy : SortBy.None}
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
