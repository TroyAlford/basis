import * as React from 'react'
import { get, sortBy } from '@basis/utilities'
import type { PathOf } from '../../../utilities/types/PathOf'
import type { Mixin } from '../../types/Mixin'
import { Pin } from '../../types/Pin'
import { SortDirection } from '../../types/SortDirection'
import { Editor } from '../Editor/Editor'
import { Cell } from './Cell'
import type { ColumnProps } from './Column'
import { Column, ColumnType } from './Column'
import { HeaderCell } from './HeaderCell'

import './Table.styles.ts'

interface Props<T> {
  children?: React.ReactNode,
  className?: string,
  keyField?: PathOf<T>,
}

interface State<T> {
  definitions?: Map<PathOf<T>, ColumnProps<T, PathOf<T>>>,
  prevChildren?: React.ReactNode,
  states?: Map<PathOf<T>, Partial<ColumnProps<T, PathOf<T>>>>,
}

export class Table<T extends object = { id: string }>
  extends Editor<T[], HTMLTableElement, Props<T>, State<T>> {
  static displayName = 'Table'
  static Cell = Cell
  static Column = Column
  static ColumnType = ColumnType
  static HeaderCell = HeaderCell

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

  static getDerivedStateFromProps<T extends object>(nextProps: Props<T>, prevState: State<T>): State<T> {
    // Recompute definitions if children changed
    if (nextProps.children !== prevState.prevChildren) {
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
          const { field } = definition

          definitions.set(field, definition)
          if (!prevState.states?.has(field)) {
            prevState.states.set(field, { ...definition })
          }
        })

      return {
        definitions,
        prevChildren: nextProps.children,
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

      this.forceUpdate()
    }
  }

  get columns(): ColumnProps<T, PathOf<T>>[] {
    const { states = new Map() } = this.state

    const columns: ColumnProps<T, PathOf<T>>[] = []
    for (const [, state] of states) {
      columns.push({ ...state })
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

    if (!columns.length) return null

    // Look for any column with a sort direction and sort accordingly
    const sortedColumn = columns.find(col => col.sortDirection)
    let displayData = data
    if (sortedColumn) {
      displayData = sortBy(data, row => get<T>(row, sortedColumn.field) as string | number | boolean | Date)
      if (sortedColumn.sortDirection === SortDirection.Desc) {
        displayData = displayData.reverse()
      }
    }

    return (
      <table>
        <thead>
          <tr key="header">
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
  }
}
