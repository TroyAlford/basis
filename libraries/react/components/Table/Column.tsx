import * as React from 'react'
import type { TypeAt } from '@basis/utilities'
import type { PathOf } from '../../../utilities/types/PathOf'
import { Pin } from '../../types/Pin'
import { SortBy } from '../../types/SortBy'
import type { SortDirection } from '../../types/SortDirection'
import { TextAlign } from '../../types/TextAlign'
import { Component } from '../Component/Component'

export enum ColumnType {
  Boolean = 'boolean',
  Date = 'date',
  Enum = 'enum',
  Number = 'number',
  Text = 'text',
}

export interface CellProps<T, R = unknown, F extends PathOf<R> = PathOf<R>> {
  column: ColumnProps<R, F>,
  field: F,
  row: R,
  value: T,
}

export interface ColumnProps<TRow = unknown, TField extends PathOf<TRow> = PathOf<TRow>> {
  align?: TextAlign,
  component?: React.ComponentType<CellProps<TypeAt<TRow, TField>, TRow, TField>>,
  enum?: Record<string, string | number>,
  field: TField,
  header?: boolean,
  pin?: Pin,
  sortBy?: SortBy,
  sortDirection?: SortDirection | null,
  sortable?: boolean,
  title?: string,
  type?: ColumnType,
  width?: string | number,
}

export class Column<TRow, TField extends PathOf<TRow> = PathOf<TRow>>
  extends Component<ColumnProps<TRow, TField>> {
  static displayName = 'Table.Column'

  static get defaultProps() {
    return {
      ...super.defaultProps,
      pin: Pin.Unpinned,
      sortDirection: null,
      sortable: true,
      width: 'auto',
    }
  }

  // Static column type components
  static Boolean<TRow, TField extends PathOf<TRow> = PathOf<TRow>>(declaration: ColumnProps<TRow, TField>) {
    const props = {
      ...Column.defaultProps,
      align: TextAlign.Center,
      sortBy: SortBy.Value,
      ...declaration,
      type: ColumnType.Boolean,
    }
    return <Column<TRow, TField> {...props} />
  }
  static Date<TRow, TField extends PathOf<TRow> = PathOf<TRow>>(declaration: ColumnProps<TRow, TField>) {
    const props = {
      ...Column.defaultProps,
      align: TextAlign.Center,
      sortBy: SortBy.Value,
      ...declaration,
      type: ColumnType.Date,
    }
    return <Column<TRow, TField> {...props} />
  }
  static Enum<TRow, TField extends PathOf<TRow> = PathOf<TRow>>(declaration: ColumnProps<TRow, TField>) {
    const props = {
      ...Column.defaultProps,
      align: TextAlign.Left,
      sortBy: SortBy.Name,
      ...declaration,
      type: ColumnType.Enum,
    }
    return <Column<TRow, TField> {...props} />
  }
  static Number<TRow, TField extends PathOf<TRow> = PathOf<TRow>>(
    declaration: ColumnProps<TRow, TField>,
  ) {
    const props = {
      ...Column.defaultProps,
      align: TextAlign.Right,
      sortBy: SortBy.Value,
      ...declaration,
      type: ColumnType.Number,
    }
    return <Column<TRow, TField> {...props} />
  }
  static Text<TRow, TField extends PathOf<TRow> = PathOf<TRow>>(declaration: ColumnProps<TRow, TField>) {
    const props = {
      ...Column.defaultProps,
      align: TextAlign.Left,
      sortBy: SortBy.Name,
      ...declaration,
      type: ColumnType.Text,
    }
    return <Column<TRow, TField> {...props} />
  }

  /*
   * This component doesn't render anything directly
   * It's used by Table to extract column configuration
   */
  content(): React.ReactNode { return null }
}
