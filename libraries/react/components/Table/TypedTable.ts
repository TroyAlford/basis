import type { PathOf } from '@basis/utilities/types/PathOf'
import type { ColumnProps } from './Column'
import { Column } from './Column'
import { Table } from './Table'

interface TypedTableInterface<TRow extends object> {
  Column: {
    Boolean: (props: ColumnProps<TRow, PathOf<TRow>>) => React.ReactNode,
    Date: (props: ColumnProps<TRow, PathOf<TRow>>) => React.ReactNode,
    Enum: (props: ColumnProps<TRow, PathOf<TRow>>) => React.ReactNode,
    Number: (props: ColumnProps<TRow, PathOf<TRow>>) => React.ReactNode,
    Text: (props: ColumnProps<TRow, PathOf<TRow>>) => React.ReactNode,
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
