import type * as React from 'react'
import type { PathOf } from '../../../utilities/types/PathOf'
import type { CellComponent } from './CellContent'
import type { ColumnProps } from './Column'
import { Column } from './Column'
import { Table } from './Table'

interface TypedTableInterface<TRow extends object> {
  Column: {
    Boolean: <TField extends PathOf<TRow>>(props: ColumnProps<TRow, TField>) => React.ReactNode,
    Custom: <TField extends PathOf<TRow>>(
      props: ColumnProps<TRow, TField> & { component: CellComponent<TRow, TField> },
    ) => React.ReactNode,
    Date: <TField extends PathOf<TRow>>(props: ColumnProps<TRow, TField>) => React.ReactNode,
    DateTime: <TField extends PathOf<TRow>>(props: ColumnProps<TRow, TField>) => React.ReactNode,
    Enum: <TField extends PathOf<TRow>>(props: ColumnProps<TRow, TField>) => React.ReactNode,
    Number: <TField extends PathOf<TRow>>(props: ColumnProps<TRow, TField>) => React.ReactNode,
    Text: <TField extends PathOf<TRow>>(props: ColumnProps<TRow, TField>) => React.ReactNode,
  },
  Table: React.ComponentType<Table<TRow>['props']>,
}

export const TypedTable = {
  of<T extends object = { id: string }>(): TypedTableInterface<T> {
    return {
      Column: Column as TypedTableInterface<T>['Column'],
      Table: Table as unknown as TypedTableInterface<T>['Table'],
    }
  },
}
