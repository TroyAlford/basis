import * as React from 'react'
import type { PathOf } from '../../../utilities/types/PathOf'
import { Pin } from '../../types/Pin'
import { SortBy } from '../../types/SortBy'
import type { SortDirection } from '../../types/SortDirection'
import { TextAlign } from '../../types/TextAlign'
import { Component } from '../Component/Component'
import type { CellComponent, ColumnDeclaration, ColumnFactory } from './CellContent'

export enum ColumnType {
  Boolean = 'boolean',
  Custom = 'custom',
  Date = 'date',
  DateTime = 'datetime',
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
  component?: CellComponent<TRow, TField>,
  enum?: Record<string, string | number>,
  field: TField,
  header?: boolean,
  pin?: Pin,
  sortBy?: SortBy,
  sortDirection?: SortDirection | null,
  sortable?: boolean,
  title?: React.ReactNode,
  type?: ColumnType,
  width?: string | number,
}

export class Column<TRow, TField extends PathOf<TRow> = PathOf<TRow>>
  extends Component<ColumnProps<TRow, TField>> {
  static displayName = 'Table.Column'

  /** `title` is the column heading, not a native `title` tooltip. */
  static ownedNativeProps = ['title']

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
  static DateTime<TRow, TField extends PathOf<TRow> = PathOf<TRow>>(declaration: ColumnProps<TRow, TField>) {
    const props = {
      ...Column.defaultProps,
      align: TextAlign.Center,
      sortBy: SortBy.Value,
      ...declaration,
      type: ColumnType.DateTime,
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
  static Custom<TRow, TField extends PathOf<TRow> = PathOf<TRow>>(
    declaration: ColumnProps<TRow, TField> & { component: CellComponent<TRow, TField> },
  ) {
    const props = {
      ...Column.defaultProps,
      align: TextAlign.Left,
      sortBy: SortBy.Name,
      ...declaration,
      type: ColumnType.Custom,
    }
    return <Column<TRow, TField> {...props} />
  }
  /**
   * Create a reusable custom column factory with its cell component and defaults
   * already bound. Register it once with {@link TypedTable.extend} and call it
   * with only the field and per-use options.
   * @param component - The cell component, usually a {@link CellContent} subclass.
   * @param defaults - Column options applied before each per-use declaration.
   * @returns A row-bound column factory.
   */
  static custom<TRow extends object>(
    component: CellComponent<TRow, PathOf<TRow>>,
    defaults: Partial<Omit<ColumnProps<TRow>, 'component' | 'field' | 'type'>> = {},
  ): ColumnFactory<TRow> {
    const factory = <TColumnField extends PathOf<TRow>>(
      declaration: ColumnDeclaration<TRow, TColumnField>,
    ) => Column.Custom({
      ...defaults,
      ...declaration,
      component: component as CellComponent<TRow, TColumnField>,
    })

    return factory as ColumnFactory<TRow>
  }

  /*
   * This component doesn't render anything directly
   * It's used by Table to extract column configuration
   */
  content(): React.ReactNode { return null }
}
