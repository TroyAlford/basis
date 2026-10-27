import type * as React from 'react'
import type { PathOf } from '../../../utilities/types/PathOf'
import type { TypeAt } from '../../../utilities/types/TypeAt'
import { Component } from '../Component/Component'
import type { CellProps, ColumnProps } from './Column'

/**
 * Type-only brand identifying a reusable column factory's bound row without
 * expanding its generic signatures.
 */
export declare const columnFactoryBrand: unique symbol

/**
 * Type-only brand identifying concrete cell classes without expanding the cell's generics.
 * It gives constructor constraints a cell-specific identity that stays cheap to instantiate.
 */
export declare const cellContentBrand: unique symbol

/**
 * Constructor constraint for a Basis class cell. The brand and public `row` make the
 * constraint nominal, so a cell declared for one row type is not accepted for another.
 */
type CellContentClass<TRow> = new (...args: never[]) => {
  readonly [cellContentBrand]: true,
  readonly props: { readonly row: TRow },
}

/**
 * A custom table cell: either a React component accepting the cell contract or a Basis
 * class extending {@link CellContent}. Function components remain supported for interop;
 * Basis package and application cells use the class form.
 */
export type CellComponent<TRow, TField extends PathOf<TRow> = PathOf<TRow>> =
  | React.ComponentType<CellProps<TypeAt<TRow, TField>, TRow, TField>>
  | CellContentClass<TRow>

/**
 * Public base class for custom cell content.
 *
 * Extend this class and implement {@link content} to render a cell from its row, value,
 * field, or column declaration. The table renders the class in place of the built-in
 * editor for the column.
 * @template TRow The table's row type.
 * @template TField The declared column field.
 */
export abstract class CellContent<TRow, TField extends PathOf<TRow> = PathOf<TRow>>
  extends Component<CellProps<TypeAt<TRow, TField>, TRow, TField>> {
  declare readonly [cellContentBrand]: true

  abstract override content(): React.ReactNode
}

/**
 * A reusable custom column factory with its cell component and defaults already
 * bound. The row it was created for is carried by a type-only brand so
 * {@link TypedTable.extend} can expose it only on compatible table rows.
 */
export interface ColumnFactory<TRow extends object> {
  <TField extends PathOf<TRow>>(declaration: ColumnDeclaration<TRow, TField>): React.ReactNode,
  readonly [columnFactoryBrand]: TRow,
}

/** Structural base accepted by the column registry in `TypedTable.extend`. */
export interface ColumnFactoryBase {
  readonly [columnFactoryBrand]: object,
}

/**
 * A column declaration accepted by a registered factory. The factory owns the
 * cell component, so callers cannot replace it.
 */
export type ColumnDeclaration<TRow extends object, TField extends PathOf<TRow>> =
  Omit<ColumnProps<TRow, TField>, 'component'>

/**
 * Extract the row type a column factory is bound to.
 */
export type ColumnFactoryRow<F> = F extends { readonly [columnFactoryBrand]: infer Row }
  ? Row
  : never
