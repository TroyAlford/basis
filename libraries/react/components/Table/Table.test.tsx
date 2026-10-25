import { describe, expect, mock, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
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
  describe('titles', () => {
    test('renders a plain text title with native header semantics', async () => {
      const { node } = await render(
        <Table value={ROWS}>
          {Column.Boolean({ field: 'status', title: 'Status' })}
        </Table>,
      )

      const header = headerFor(node, 'status')
      expect(header).toHaveTextContent('Status')
      expect(header).not.toHaveAttribute('aria-label')
      expect(header).toHaveAttribute('aria-sort', 'none')

      header.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flush()
      expect(header).toHaveAttribute('aria-sort', 'ascending')

      header.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
      await flush()
      expect(header).toHaveAttribute('aria-sort', 'descending')
    })

    test('renders arbitrary React content in a title', async () => {
      const onActivate = mock()
      const { node } = await render(
        <Table value={ROWS}>
          {Column.Boolean({
            field: 'status',
            title: (
              <>
                <span>Status</span>
                <button type="button" onClick={onActivate}>Act</button>
              </>
            ),
          })}
        </Table>,
      )

      const header = headerFor(node, 'status')
      expect(header).toHaveTextContent('Status')
      expect(header).toHaveTextContent('Act')
      expect(header.querySelector('button')).not.toBeNull()
    })
  })

  describe('header interactions', () => {
    test('sorts on a pointer header activation but not a nested control', async () => {
      const onActivate = mock()
      const { node } = await render(
        <Table value={ROWS}>
          {Column.Boolean({
            field: 'status',
            title: (
              <>
                <span>Status</span>
                <button type="button" onClick={onActivate}>Act</button>
              </>
            ),
          })}
        </Table>,
      )

      const header = headerFor(node, 'status')
      const control = (): HTMLButtonElement => header.querySelector('button') as HTMLButtonElement

      control().click()
      await flush()
      expect(onActivate).toHaveBeenCalledTimes(1)
      expect(header).toHaveAttribute('aria-sort', 'none')

      header.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flush()
      expect(header).toHaveAttribute('aria-sort', 'ascending')
      expect(onActivate).toHaveBeenCalledTimes(1)

      control().click()
      await flush()
      expect(onActivate).toHaveBeenCalledTimes(2)
      expect(header).toHaveAttribute('aria-sort', 'ascending')
    })

    test('sorts on a keyboard header activation but not a nested control', async () => {
      const { node } = await render(
        <Table value={ROWS}>
          {Column.Boolean({
            field: 'status',
            title: (
              <>
                <span>Status</span>
                <input aria-label="Toggle status" type="checkbox" />
              </>
            ),
          })}
        </Table>,
      )

      const header = headerFor(node, 'status')
      const input = header.querySelector('input') as HTMLInputElement

      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ' }))
      await flush()
      expect(header).toHaveAttribute('aria-sort', 'none')

      header.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
      await flush()
      expect(header).toHaveAttribute('aria-sort', 'ascending')

      header.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ' }))
      await flush()
      expect(header).toHaveAttribute('aria-sort', 'descending')
    })

    test('updates a rich title and preserves sort state on rerender', async () => {
      const onChange = mock()

      const table = (checked: boolean, label: string, disabled = false): React.ReactElement => (
        <Table value={ROWS}>
          {Column.Boolean({
            field: 'status',
            title: (
              <>
                <span>{label}</span>
                <input
                  aria-label="Toggle status"
                  checked={checked}
                  disabled={disabled}
                  type="checkbox"
                  onChange={onChange}
                />
              </>
            ),
          })}
        </Table>
      )

      const rendered = await render(table(false, 'Status'))
      const header = headerFor(rendered.node, 'status')

      header.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flush()
      expect(header).toHaveAttribute('aria-sort', 'ascending')

      await rendered.update(table(true, 'Updated'))
      const updatedHeader = headerFor(rendered.node, 'status')
      expect(updatedHeader).toHaveAttribute('aria-sort', 'ascending')
      expect(updatedHeader).toHaveTextContent('Updated')

      const input = updatedHeader.querySelector('input') as HTMLInputElement
      expect(updatedHeader.querySelectorAll('input')).toHaveLength(1)
      expect(input.checked).toBe(true)

      input.click()
      await flush()
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(updatedHeader).toHaveAttribute('aria-sort', 'ascending')

      await rendered.update(table(true, 'Updated', true))
      expect((updatedHeader.querySelector('input') as HTMLInputElement).disabled).toBe(true)
    })

    test('takes indeterminate state from the owning consumer', async () => {
      const { node } = await render(
        <Table value={ROWS}>
          {Column.Boolean({
            field: 'status',
            title: (
              <>
                <span>Status</span>
                <CheckboxEditor
                  label="Mark all complete"
                  value={null}
                  onChange={() => undefined}
                />
              </>
            ),
          })}
        </Table>,
      )

      const header = headerFor(node, 'status')
      const input = header.querySelector('input') as HTMLInputElement
      expect(input.checked).toBe(false)
      expect(input.indeterminate).toBe(true)
      expect(input).toHaveAttribute('aria-checked', 'mixed')
      expect(input).toHaveAttribute('aria-label', 'Mark all complete')
    })
  })
})
