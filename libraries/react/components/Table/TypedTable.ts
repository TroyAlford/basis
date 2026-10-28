import type * as React from 'react'
import type { PathOf } from '../../../utilities/types/PathOf'
import type { CellComponent, ColumnFactory, ColumnFactoryBase, ColumnFactoryRow, ColumnFactoryValue, ComponentColumnDeclaration, CustomColumnDeclaration } from './CellContent'
import { Column } from './Column'
import { Table } from './Table'

/** A built-in column factory for a fixed row. */
type ColumnFactoryMethod<TRow extends object> = <
  TField extends PathOf<TRow>,
  C extends CellComponent<TRow, TField> = CellComponent<TRow, TField>,
>(props: ComponentColumnDeclaration<TRow, TField, C>) => React.ReactNode

/** A custom column factory for a fixed row. */
type CustomColumnFactoryMethod<TRow extends object> = <
  TField extends PathOf<TRow>,
  C extends CellComponent<TRow, TField> = CellComponent<TRow, TField>,
>(props: CustomColumnDeclaration<TRow, TField, C>) => React.ReactNode

interface TypedTableInterface<TRow extends object> {
  Column: {
    Boolean: ColumnFactoryMethod<TRow>,
    Custom: CustomColumnFactoryMethod<TRow>,
    Date: ColumnFactoryMethod<TRow>,
    DateTime: ColumnFactoryMethod<TRow>,
    Enum: ColumnFactoryMethod<TRow>,
    Number: ColumnFactoryMethod<TRow>,
    Text: ColumnFactoryMethod<TRow>,
  },
  Table: React.ComponentType<Table<TRow>['props']>,
}

/** Column factories registered with {@link TypedTable.extend}. */
type ColumnRegistry = Record<string, ColumnFactoryBase>

/**
 * Registered factories that are valid for a row. A factory bound to a row
 * appears for that row and its subtypes; an unrelated row does not expose it.
 */
type CompatibleColumns<TRow extends object, R extends ColumnRegistry> = {
  [K in keyof R as [TRow] extends [ColumnFactoryRow<R[K]>] ? K : never]:
  ColumnFactory<TRow, ColumnFactoryValue<R[K]>>
}

/** A table facade with the application's registered column factories. */
interface ExtendedTypedTable<TRow extends object, R extends ColumnRegistry> {
  Column: TypedTableInterface<TRow>['Column'] & CompatibleColumns<TRow, R>,
  Table: React.ComponentType<Table<TRow>['props']>,
}

/** The row-selecting facade returned by {@link TypedTable.extend}. */
export interface TypedTableExtender<R extends ColumnRegistry> {
  of<TRow extends object = { id: string }>(): ExtendedTypedTable<TRow, R>,
}

export const TypedTable = {
  /**
   * Register application column factories once and reuse them through
   * `.of<Row>()`. Registered names are added to the built-in column factories.
   * @param registry - Pre-bound factories created with {@link Column.custom}.
   * @returns A row-selecting table facade with the registered columns.
   */
  extend<const R extends ColumnRegistry>(registry: R): TypedTableExtender<R> {
    return {
      of: <T extends object = { id: string }>(): ExtendedTypedTable<T, R> => ({
        Column: Object.assign(Object.create(Column), registry) as ExtendedTypedTable<T, R>['Column'],
        Table: Table as unknown as React.ComponentType<Table<T>['props']>,
      }),
    }
  },

  of<T extends object = { id: string }>(): TypedTableInterface<T> {
    return {
      Column: Column as TypedTableInterface<T>['Column'],
      Table: Table as unknown as TypedTableInterface<T>['Table'],
    }
  },
}
