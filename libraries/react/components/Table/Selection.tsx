import * as React from 'react'
import { Pinnable } from '../../mixins/Pinnable'
import type { Mixin } from '../../types/Mixin'
import type { Pin } from '../../types/Pin'
import { TextAlign } from '../../types/TextAlign'
import { CheckboxEditor } from '../CheckboxEditor/CheckboxEditor'
import { Component } from '../Component/Component'

/** A stable string or numeric row key. */
export type TableKey = string | number

/** The public controlled interaction state of a table. */
export interface TableState {
  /** The currently selected row keys. */
  selectedRows: Set<TableKey>,
}

/** The table-owned context consumed by the selection header and cells. */
export interface SelectionContextValue {
  onStateChange: (state: TableState) => void,
  rowKeys: readonly TableKey[],
  selectedRows: ReadonlySet<TableKey>,
}

/** The field identifier reserved for the selection column. */
export const SELECTION_FIELD = '__selection__'

/** The default width of the selection column. */
export const SELECTION_COLUMN_WIDTH = '2.5em'

/** The context shared by the selection header and body cells. */
export const SelectionContext = React.createContext<SelectionContextValue | null>(null)

/**
 * The header checkbox that selects or clears all current row keys.
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
    const { rowKeys, selectedRows } = context
    const selected = rowKeys.filter(key => selectedRows.has(key)).length
    const value = selected === 0 ? false : selected === rowKeys.length ? true : null

    return (
      <CheckboxEditor
        disabled={rowKeys.length === 0}
        label="Select all rows"
        value={value}
        onChange={this.handleChange(context)}
      />
    )
  }

  private handleChange(context: SelectionContextValue) {
    return (value: boolean | null): void => {
      const { onStateChange, rowKeys, selectedRows } = context
      if (!rowKeys.length) return

      const next = new Set(selectedRows)
      if (value === true) rowKeys.forEach(key => next.add(key))
      else rowKeys.forEach(key => next.delete(key))

      onStateChange({ selectedRows: next })
    }
  }
}

/**
 * A body cell that renders one row's controlled selection checkbox.
 */
export class SelectionCell extends Component<{
  pin?: Pin,
  rowKey: TableKey,
}, HTMLTableCellElement> {
  static displayName = 'Table.SelectionCell'
  static get mixins(): Set<Mixin> {
    return super.mixins.add(Pinnable)
  }

  get attributes() {
    return {
      ...super.attributes,
      'data-align': TextAlign.Center,
      'data-field': SELECTION_FIELD,
      'style': { minWidth: SELECTION_COLUMN_WIDTH, width: SELECTION_COLUMN_WIDTH },
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
    return (
      <CheckboxEditor
        label={`Select row ${this.props.rowKey}`}
        value={context.selectedRows.has(this.props.rowKey)}
        onChange={this.handleChange(context)}
      />
    )
  }

  private handleChange(context: SelectionContextValue) {
    return (value: boolean | null): void => {
      const next = new Set(context.selectedRows)
      if (value === true) next.add(this.props.rowKey)
      else next.delete(this.props.rowKey)

      context.onStateChange({ selectedRows: next })
    }
  }
}
