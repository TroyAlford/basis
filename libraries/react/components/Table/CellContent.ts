import type * as React from 'react'
import type { PathOf } from '../../../utilities/types/PathOf'
import type { TypeAt } from '../../../utilities/types/TypeAt'
import { Component } from '../Component/Component'
import type { CellProps, ColumnProps } from './Column'

/**
 * Type-only brand identifying a reusable column factory's bound row without
 * expanding its generic signatures.
 */
declare const columnFactoryBrand: unique symbol

/**
 * Type-only brand identifying concrete cell classes without expanding the cell's generics.
 * It gives constructor constraints a cell-specific identity that stays cheap to instantiate.
 */
declare const cellContentBrand: unique symbol

/**
 * Constructor constraint for a Basis class cell. The brand, row, and value make
 * the constraint nominal, so a cell declared for one row or value type is not
 * accepted for an incompatible one.
 */
export type CellContentClass<TRow, TValue = unknown> = new (...args: never[]) => {
  readonly [cellContentBrand]: true,
  readonly props: { readonly row: TRow, readonly value: TValue },
}

/**
 * A custom table cell: either a React component accepting the cell contract or a Basis
 * class extending {@link CellContent}. Function components remain supported for interop;
 * Basis package and application cells use the class form.
 */
export type CellComponent<TRow, TField extends PathOf<TRow> = PathOf<TRow>> =
  | React.ComponentType<CellProps<TypeAt<TRow, TField>, TRow, TField>>
  | CellContentClass<TRow, unknown>

/**
 * The value type a class cell accepts, or `unknown` for a non-class component.
 */
export type CellClassValueOf<C> = C extends CellContentClass<object, infer TValue> ? TValue : unknown

/**
 * Guards a class cell whose declared value cannot accept the column's value.
 * A cell that accepts the union of all row values remains valid for any field.
 */
export type CellValueCompatible<TRow extends object, TField extends PathOf<TRow>, C> =
  C extends CellContentClass<object, infer TValue>
    ? [TypeAt<TRow, TField>] extends [TValue] ? unknown : never
    : unknown

/**
 * Guards a value against the value type declared by a registered factory.
 */
export type ValueCompatible<TValue, TDeclared> = [TValue] extends [TDeclared] ? unknown : never

/**
 * A column declaration whose optional component is checked against the field value.
 */
export type ComponentColumnDeclaration<
  TRow extends object,
  TField extends PathOf<TRow>,
  C extends CellComponent<TRow, TField> = CellComponent<TRow, TField>,
> = ColumnProps<TRow, TField> & {
  component?: C & CellValueCompatible<TRow, TField, C>,
}

/**
 * A custom column declaration whose component is required.
 */
export type CustomColumnDeclaration<
  TRow extends object,
  TField extends PathOf<TRow>,
  C extends CellComponent<TRow, TField> = CellComponent<TRow, TField>,
> = ColumnProps<TRow, TField> & {
  component: C & CellValueCompatible<TRow, TField, C>,
}

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
 * bound. The row and value it was created for are carried by a type-only brand
 * so {@link TypedTable.extend} can expose it only on compatible table rows and
 * fields.
 */
export interface ColumnFactory<TRow extends object, TValue = unknown> {
  <TField extends PathOf<TRow>>(
    declaration: ColumnDeclaration<TRow, TField> & ValueCompatible<TypeAt<TRow, TField>, TValue>,
  ): React.ReactNode,
  readonly [columnFactoryBrand]: { readonly row: TRow, readonly value: TValue },
}

/** Structural base accepted by the column registry in `TypedTable.extend`. */
export interface ColumnFactoryBase {
  readonly [columnFactoryBrand]: { readonly row: object, readonly value: unknown },
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
export type ColumnFactoryRow<F extends ColumnFactoryBase> = F[typeof columnFactoryBrand]['row']

/**
 * Extract the value type a column factory is bound to.
 */
export type ColumnFactoryValue<F extends ColumnFactoryBase> = F[typeof columnFactoryBrand]['value']
