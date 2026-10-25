import * as React from 'react'
import { Pinnable } from '../../mixins/Pinnable'
import type { Mixin } from '../../types/Mixin'
import type { Pin } from '../../types/Pin'
import { TextAlign } from '../../types/TextAlign'
import { CheckboxEditor } from '../CheckboxEditor/CheckboxEditor'
import { Component } from '../Component/Component'

/** A stable row or page key used by controlled selection. */
export type TableKey = string | number

/** The disabled state a consumer can declare for a row. */
export interface RowSelectionState {
  /** Whether the row's checkbox is disabled. */
  disabled: boolean,
  /** Why the row cannot be selected. */
  reason?: string,
}

/** A consumer's row-selectability declaration. */
export type RowSelectionDeclaration = boolean | RowSelectionState

/**
 * Controlled row-selection configuration for a `Table`.
 *
 * The consumer owns the selected keys and the meaning of a page. The table only
 * renders checkboxes and requests the next set through `onChange`.
 */
export interface TableSelection<T> {
  /** Declares whether a row can be selected, optionally with a reason. */
  getRowState?: (row: T) => RowSelectionDeclaration,
  /** Called with a new set when a row or the page checkbox is activated. */
  onChange: (selectedKeys: Set<TableKey>) => void,
  /**
   * The keys eligible for the header's Select Page checkbox. Defaults to the
   * selectable keys in the current visible rows; supply this when the consumer
   * needs all filtered or all matching keys.
   */
  pageKeys?: readonly TableKey[],
  /** The header checkbox's accessible label. Defaults to "Select page". */
  pageLabel?: string,
  /** A human-readable label for a row's checkbox. Defaults to the row key. */
  rowLabel?: (row: T) => string,
  /** The rows that are currently selected, keyed by `keyField`. */
  selectedKeys: ReadonlySet<TableKey>,
  /** The selection column's width. Defaults to 2.5em. */
  width?: string | number,
}

/** The table-owned context consumed by the selection header and cells. */
export interface SelectionContextValue {
  getKey: (row: unknown) => TableKey | null,
  getRowState: (row: unknown) => RowSelectionState,
  onChange: (selectedKeys: Set<TableKey>) => void,
  pageKeys: readonly TableKey[],
  pageLabel: string,
  rowLabel: (row: unknown) => string,
  selectedKeys: ReadonlySet<TableKey>,
}

/** The field identifier reserved for the selection column. */
export const SELECTION_FIELD = '__selection__'

/** The default width of the selection column. */
export const SELECTION_COLUMN_WIDTH = '2.5em'

/** The context shared by the selection header and body cells. */
export const SelectionContext = React.createContext<SelectionContextValue | null>(null)

/**
 * The header checkbox that selects or clears the consumer's page keys.
 */
export class SelectionHeader extends Component<Record<string, never>, HTMLSpanElement> {
  static displayName = 'Table.SelectionHeader'

  get tag(): keyof React.JSX.IntrinsicElements { return 'span' }

  content(): React.ReactNode {
    return (
      <SelectionContext.Consumer>
        {context => (context ? this.renderCheckbox(context) : null)}
      </SelectionContext.Consumer>
    )
  }

  private renderCheckbox(context: SelectionContextValue): React.ReactNode {
    const { pageKeys, pageLabel, selectedKeys } = context
    const selected = pageKeys.filter(key => selectedKeys.has(key)).length
    const value = selected === 0 ? false : selected === pageKeys.length ? true : null

    return (
      <CheckboxEditor
        disabled={pageKeys.length === 0}
        label={pageLabel}
        value={value}
        onChange={this.handleChange(context)}
      />
    )
  }

  private handleChange(context: SelectionContextValue) {
    return (value: boolean | null): void => {
      const { onChange, pageKeys, selectedKeys } = context
      if (!pageKeys.length) return

      const allSelected = pageKeys.every(key => selectedKeys.has(key))
      const next = new Set(selectedKeys)

      if (value === true || (value === null && !allSelected)) {
        pageKeys.forEach(key => next.add(key))
      } else {
        pageKeys.forEach(key => next.delete(key))
      }

      onChange(next)
    }
  }
}

/**
 * A body cell that renders one row's controlled selection checkbox.
 */
export class SelectionCell extends Component<{
  pin?: Pin,
  row: unknown,
  width?: string | number,
}, HTMLTableCellElement> {
  static displayName = 'Table.SelectionCell'
  static get mixins(): Set<Mixin> {
    return super.mixins.add(Pinnable)
  }

  get attributes() {
    const width = this.props.width ?? SELECTION_COLUMN_WIDTH

    return {
      ...super.attributes,
      'data-align': TextAlign.Center,
      'data-field': SELECTION_FIELD,
      'style': { minWidth: width, width },
    }
  }

  get classNames(): Set<string> {
    return super.classNames.add('table-cell')
  }

  get tag(): keyof React.JSX.IntrinsicElements { return 'td' }

  content(): React.ReactNode {
    return (
      <SelectionContext.Consumer>
        {context => (context ? this.renderCheckbox(context) : null)}
      </SelectionContext.Consumer>
    )
  }

  private renderCheckbox(context: SelectionContextValue): React.ReactNode {
    const key = context.getKey(this.props.row)
    if (key === null) return null

    const { disabled, reason } = context.getRowState(this.props.row)
    const label = `Select row ${context.rowLabel(this.props.row)}`
    const describedLabel = reason ? `${label} (${reason})` : label

    return (
      <CheckboxEditor
        disabled={disabled}
        label={describedLabel}
        value={context.selectedKeys.has(key)}
        onChange={this.handleChange(context, key, disabled)}
      />
    )
  }

  private handleChange(context: SelectionContextValue, key: TableKey, disabled: boolean) {
    return (value: boolean | null): void => {
      if (disabled) return

      const next = new Set(context.selectedKeys)
      if (value === true) next.add(key)
      else next.delete(key)

      context.onChange(next)
    }
  }
}
