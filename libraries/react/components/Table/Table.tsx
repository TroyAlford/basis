import * as React from 'react'
import { deepEquals, get, sortBy } from '../../../utilities'
import type { PathOf } from '../../../utilities/types/PathOf'
import type { Mixin } from '../../types/Mixin'
import { Pin } from '../../types/Pin'
import { SortDirection } from '../../types/SortDirection'
import { TextAlign } from '../../types/TextAlign'
import { Editor } from '../Editor/Editor'
import { Cell } from './Cell'
import type { ColumnProps } from './Column'
import { Column, ColumnType } from './Column'
import { HeaderCell } from './HeaderCell'
import type { RowSelectionState, SelectionContextValue, TableKey, TableSelection } from './Selection'
import { SELECTION_COLUMN_WIDTH, SELECTION_FIELD, SelectionCell, SelectionContext, SelectionHeader } from './Selection'

import './Table.styles.ts'

interface Props<T> {
  children?: React.ReactNode,
  className?: string,
  keyField?: PathOf<T>,
  selection?: TableSelection<T>,
}

interface State<T> {
  definitions?: Map<PathOf<T>, ColumnProps<T, PathOf<T>>>,
  prevChildren?: React.ReactNode,
  states?: Map<PathOf<T>, Partial<ColumnProps<T, PathOf<T>>>>,
}

/**
 * Compare two column definitions without traversing ReactNode titles.
 * @param one - The next definition.
 * @param two - The previous definition.
 * @returns Whether every declared value is the same reference or primitive.
 */
function shallowEqual(one: object, two: object): boolean {
  const oneKeys = Object.keys(one)
  const twoKeys = Object.keys(two)
  if (oneKeys.length !== twoKeys.length) return false

  return oneKeys.every(key => (
    (one as Record<string, unknown>)[key] === (two as Record<string, unknown>)[key]
  ))
}

export class Table<T extends object = { id: string }>
  extends Editor<T[], HTMLTableElement, Props<T>, State<T>> {
  static displayName = 'Table'
  static Cell = Cell
  static Column = Column
  static ColumnType = ColumnType
  static HeaderCell = HeaderCell

  private columnCache = new WeakMap<object, ColumnProps<T, PathOf<T>>>()

  static get mixins(): Set<Mixin> {
    return super.mixins
  }

  static get defaultProps() {
    return {
      ...super.defaultProps,
      keyField: 'id',
    }
  }
  override get defaultState() {
    return {
      ...super.defaultState,
      definitions: new Map<PathOf<T>, ColumnProps<T, PathOf<T>>>(),
      prevChildren: null,
      states: new Map<PathOf<T>, Partial<ColumnProps<T, PathOf<T>>>>(),
    }
  }

  shouldComponentUpdate(nextProps: Props<T>, nextState: State<T>): boolean {
    if (nextProps.selection?.selectedKeys !== this.props.selection?.selectedKeys) return true
    return !deepEquals(this.props, nextProps) || !deepEquals(this.state, nextState)
  }

  private getSelectionKey = (row: unknown): TableKey | null => {
    const key = get(row as T, this.props.keyField)
    return typeof key === 'string' || typeof key === 'number' ? key : null
  }

  private getRowSelection = (row: unknown): RowSelectionState => {
    const declaration = this.props.selection?.getRowState?.(row as T)

    if (declaration === false) return { disabled: true }
    if (declaration === undefined || declaration === true) return { disabled: false }

    return { disabled: declaration.disabled, reason: declaration.reason }
  }

  private getRowLabel = (row: unknown): string => {
    const selection = this.props.selection
    if (selection?.rowLabel) return selection.rowLabel(row as T)

    const key = this.getSelectionKey(row)
    return key === null ? '' : String(key)
  }

  private get pageKeys(): readonly TableKey[] {
    const selection = this.props.selection
    if (!selection) return []
    if (selection.pageKeys) return selection.pageKeys

    return (this.current ?? [])
      .filter(row => !this.getRowSelection(row).disabled)
      .map(row => this.getSelectionKey(row))
      .filter((key): key is TableKey => key !== null)
  }

  private get selectionColumn(): ColumnProps<T, PathOf<T>> | null {
    const selection = this.props.selection
    if (!selection) return null

    return {
      align: TextAlign.Center,
      field: SELECTION_FIELD as PathOf<T>,
      pin: Pin.Left,
      sortable: false,
      title: <SelectionHeader />,
      width: selection.width ?? SELECTION_COLUMN_WIDTH,
    }
  }

  private get selectionContext(): SelectionContextValue | null {
    const selection = this.props.selection
    if (!selection) return null

    return {
      getKey: this.getSelectionKey,
      getRowState: this.getRowSelection,
      onChange: selection.onChange,
      pageKeys: this.pageKeys,
      pageLabel: selection.pageLabel ?? 'Select page',
      rowLabel: this.getRowLabel,
      selectedKeys: selection.selectedKeys,
    }
  }

  static getDerivedStateFromProps<T extends object>(nextProps: Props<T>, prevState: State<T>): State<T> {
    // Recompute definitions if children changed
    if (nextProps.children !== prevState.prevChildren) {
      const previousDefinitions = prevState.definitions ?? new Map<PathOf<T>, ColumnProps<T, PathOf<T>>>()
      const states = new Map(prevState.states ?? new Map<PathOf<T>, Partial<ColumnProps<T, PathOf<T>>>>())
      const definitions = new Map<PathOf<T>, ColumnProps<T, PathOf<T>>>()

      React.Children.toArray(nextProps.children)
        .filter(child => React.isValidElement(child))
        .forEach(child => {
          // Get the defaultProps from the component class
          const ComponentClass = child.type as typeof Column
          const defaultProps = ComponentClass.defaultProps || {}
          const childProps = child.props as ColumnProps<T, PathOf<T>>

          // Merge defaultProps with actual props
          const definition = {
            ...defaultProps,
            ...childProps,
          } as ColumnProps<T, PathOf<T>>

          /*
           * Component.defaultProps creates a fresh noop on every read. Columns
           * never use it, and retaining it would make every declaration look
           * changed on a parent render.
           */
          delete (definition as { onKeyDown?: unknown }).onKeyDown
          const { field } = definition

          definitions.set(field, definition)
          const previous = previousDefinitions.get(field)
          const current = states.get(field)
          const unchanged = current !== undefined
            && previous !== undefined
            && shallowEqual(definition, previous)

          /*
           * Sorting is table state, so a rerender preserves it while the
           * consumer's declaration is unchanged. When the consumer declares a
           * new sort direction, that declaration wins.
           */
          const preserveSort = previous !== undefined
            && current !== undefined
            && definition.sortDirection === previous.sortDirection
          const sortDirection = preserveSort && current ? current.sortDirection : definition.sortDirection

          /*
           * Reuse the previous state object for an unchanged declaration so
           * body cells keep stable column props during selection updates.
           */
          const nextState = unchanged && current && sortDirection === current.sortDirection
            ? current
            : { ...definition, sortDirection }

          states.set(field, nextState)
        })

      // Drop state for columns the consumer removed.
      for (const field of states.keys()) {
        if (!definitions.has(field)) states.delete(field)
      }

      return {
        definitions,
        prevChildren: nextProps.children,
        states,
      }
    }

    return null
  }

  private rowId = (row: T, index: number): string | number => {
    const keyField = this.props.keyField
    return (get(row, keyField) || index) as string | number
  }

  private handleColumnChange = (change: ColumnProps<T, PathOf<T>>) => {
    const { states } = this.state
    const field = change.field
    const state = states.get(field)

    // If sort direction changed, clear other columns' sort directions
    if (state.sortDirection !== change.sortDirection) {
      states.forEach(column => {
        if (column.field === field) {
          column.sortDirection = change.sortDirection
        } else {
          column.sortDirection = null
        }
      })

      /*
       * Sorting mutates the existing column state, so cached column props must
       * be rebuilt before the next render sees the new direction.
       */
      this.columnCache = new WeakMap<object, ColumnProps<T, PathOf<T>>>()
      this.forceUpdate()
    }
  }

  get columns(): ColumnProps<T, PathOf<T>>[] {
    const { states = new Map() } = this.state

    const columns: ColumnProps<T, PathOf<T>>[] = []
    for (const [, state] of states) {
      let column = this.columnCache.get(state)

      if (!column) {
        column = { ...state } as ColumnProps<T, PathOf<T>>
        this.columnCache.set(state, column)
      }

      columns.push(column)
    }

    // Sort columns by pin priority: Left → Unpinned → Right
    return sortBy(columns, column => {
      switch (column.pin) {
        case Pin.Left: return 0
        case Pin.Right: return 2
        default: return 1
      }
    })
  }

  content(): React.ReactNode {
    const data = this.current ?? []
    const columns = this.columns
    const selection = this.props.selection
    const selectionColumn = this.selectionColumn
    const context = this.selectionContext

    if (!columns.length && !selection) return null

    // Look for any column with a sort direction and sort accordingly
    const sortedColumn = columns.find(col => col.sortDirection)
    let displayData = data
    if (sortedColumn) {
      displayData = sortBy(data, row => get<T>(row, sortedColumn.field) as string | number | boolean | Date)
      if (sortedColumn.sortDirection === SortDirection.Desc) {
        displayData = displayData.reverse()
      }
    }

    const table = (
      <table>
        <thead>
          <tr key="header">
            {selectionColumn && (
              <HeaderCell<T, PathOf<T>>
                key={SELECTION_FIELD}
                pin={Pin.Left}
                value={selectionColumn}
                onChange={this.handleColumnChange}
              />
            )}
            {columns.map(column => (
              <HeaderCell<T, PathOf<T>>
                key={column.field}
                pin={column.pin}
                value={column}
                onChange={this.handleColumnChange}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {displayData.map((row, index) => (
            <tr key={this.rowId(row, index)}>
              {selection && (
                <SelectionCell
                  key={SELECTION_FIELD}
                  pin={Pin.Left}
                  row={row}
                  width={selection.width}
                />
              )}
              {columns.map(props => {
                const { field, type } = props
                const value = get(row, field)

                return (
                  <Cell
                    key={field}
                    align={props.align}
                    column={props}
                    enum={props.enum}
                    field={field}
                    header={props.header}
                    pin={props.pin}
                    readOnly={this.props.readOnly}
                    row={row}
                    type={type}
                    value={value}
                  />
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    )

    return context ? (
      <SelectionContext.Provider value={context}>
        {table}
      </SelectionContext.Provider>
    ) : table
  }
}
