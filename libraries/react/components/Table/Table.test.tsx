import { describe, expect, mock, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { SortDirection } from '../../types/SortDirection'
import { CheckboxEditor } from '../CheckboxEditor/CheckboxEditor'
import { TypedTable } from './TypedTable'

interface TestRow {
  id: number,
  name: string,
  status: boolean,
}

const ROWS: TestRow[] = [
  { id: 1, name: 'Alpha', status: true },
  { id: 2, name: 'Bravo', status: false },
]

const { Column, Table } = TypedTable.of<TestRow>()

/**
 * Wait for a click or keydown handler's asynchronous state update to flush.
 * @returns A promise resolved after the update.
 */
const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

/**
 * The header cell for a field.
 * @param node - The rendered table.
 * @param field - The column's field.
 * @returns The header cell.
 */
const headerFor = (node: HTMLElement, field: keyof TestRow): HTMLTableCellElement => (
  node.querySelector(`th[data-field="${field}"]`) as HTMLTableCellElement
)

describe('Table', () => {
  describe('headerContent', () => {
    test('renders declarative header content and keeps title as its accessible name', async () => {
      const onChange = mock()
      const { node } = await render(
        <Table value={ROWS}>
          {Column.Boolean({
            field: 'status',
            headerContent: (
              <input aria-label="Mark all complete" type="checkbox" onChange={onChange} />
            ),
            title: 'Status',
          })}
        </Table>,
      )

      const header = headerFor(node, 'status')
      expect(header).toHaveAttribute('aria-label', 'Status')
      expect(header.querySelector('.title')).toBeNull()
      expect(header.querySelectorAll('.header-content input')).toHaveLength(1)
      expect(header.querySelector('input')).toHaveAttribute('aria-label', 'Mark all complete')
    })

    test('keeps the default title when headerContent is absent', async () => {
      const { node } = await render(
        <Table value={ROWS}>
          {Column.Boolean({ field: 'status', title: 'Status' })}
        </Table>,
      )

      const header = headerFor(node, 'status')
      expect(header).not.toHaveAttribute('aria-label')
      expect(header.querySelector('.title')).toHaveTextContent('Status')
    })

    test('does not sort when an interactive header control is activated', async () => {
      const onChange = mock()
      const { node } = await render(
        <Table value={ROWS}>
          {Column.Boolean({
            field: 'status',
            headerContent: (
              <input aria-label="Mark all complete" type="checkbox" onChange={onChange} />
            ),
            title: 'Status',
          })}
        </Table>,
      )

      const header = headerFor(node, 'status')
      const input = header.querySelector('input') as HTMLInputElement

      input.click()
      await flush()

      expect(onChange).toHaveBeenCalledTimes(1)
      expect(header).not.toHaveAttribute('data-sort-direction')
      expect(header).toHaveAttribute('aria-sort', 'none')

      header.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flush()

      expect(header).toHaveAttribute('data-sort-direction', SortDirection.Asc)
      expect(header).toHaveAttribute('aria-sort', 'ascending')
    })

    test('leaves keyboard sorting on the header and out of the header control', async () => {
      const { node } = await render(
        <Table value={ROWS}>
          {Column.Boolean({
            field: 'status',
            headerContent: <input aria-label="Mark all complete" type="checkbox" />,
            title: 'Status',
          })}
        </Table>,
      )

      const header = headerFor(node, 'status')
      const input = header.querySelector('input') as HTMLInputElement

      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ' }))
      await flush()
      expect(header).not.toHaveAttribute('data-sort-direction')

      header.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
      await flush()
      expect(header).toHaveAttribute('data-sort-direction', SortDirection.Asc)

      header.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ' }))
      await flush()
      expect(header).toHaveAttribute('data-sort-direction', SortDirection.Desc)
    })

    test('updates checked and disabled state on rerender without duplicating the control', async () => {
      const onChange = mock()

      const table = (checked: boolean, disabled = false): React.ReactElement => (
        <Table value={ROWS}>
          {Column.Boolean({
            field: 'status',
            headerContent: (
              <input
                aria-label="Mark all complete"
                checked={checked}
                disabled={disabled}
                type="checkbox"
                onChange={onChange}
              />
            ),
            title: 'Status',
          })}
        </Table>
      )

      const rendered = await render(table(false))
      expect(headerFor(rendered.node, 'status').querySelectorAll('input')).toHaveLength(1)

      await rendered.update(table(true))
      const header = headerFor(rendered.node, 'status')
      const input = header.querySelector('input') as HTMLInputElement
      expect(header.querySelectorAll('input')).toHaveLength(1)
      expect(input.checked).toBe(true)
      expect(input.disabled).toBe(false)

      input.click()
      await flush()
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(header).not.toHaveAttribute('data-sort-direction')

      await rendered.update(table(true, true))
      expect(header.querySelectorAll('input')).toHaveLength(1)
      expect(input.checked).toBe(true)
      expect(input.disabled).toBe(true)
    })

    test('takes indeterminate state from the owning consumer', async () => {
      const { node } = await render(
        <Table value={ROWS}>
          {Column.Boolean({
            field: 'status',
            headerContent: (
              <CheckboxEditor
                label="Mark all complete"
                value={null}
                onChange={() => undefined}
              />
            ),
            title: 'Status',
          })}
        </Table>,
      )

      const input = headerFor(node, 'status').querySelector('input') as HTMLInputElement
      expect(input.checked).toBe(false)
      expect(input.indeterminate).toBe(true)
      expect(input).toHaveAttribute('aria-label', 'Mark all complete')
    })
  })
})
