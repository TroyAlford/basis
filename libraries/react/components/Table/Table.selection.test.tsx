import { describe, expect, mock, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { Pin } from '../../types/Pin'
import type { RowSelectionState, TableKey } from './Selection'
import { TypedTable } from './TypedTable'

interface Person {
  id: number,
  name: string,
  notes: string,
}

const PEOPLE: Person[] = [
  { id: 1, name: 'Ada', notes: 'First' },
  { id: 2, name: 'Grace', notes: 'Second' },
  { id: 3, name: 'Linus', notes: 'Third' },
]

const { Column, Table } = TypedTable.of<Person>()

/**
 * Wait for an event handler's update to settle.
 * @returns A promise resolved after the update.
 */
const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

/**
 * The header's Select Page checkbox.
 * @param node - The rendered table.
 * @returns The checkbox input.
 */
const headerCheckbox = (node: HTMLElement): HTMLInputElement => (
  node.querySelector('thead input[type="checkbox"]') as HTMLInputElement
)

/**
 * The body row checkboxes in display order.
 * @param node - The rendered table.
 * @returns The checkbox inputs.
 */
const rowCheckboxes = (node: HTMLElement): HTMLInputElement[] => (
  Array.from(node.querySelectorAll('tbody input[type="checkbox"]')) as HTMLInputElement[]
)

interface FixtureOptions {
  getRowState?: (row: Person) => RowSelectionState,
  onChange?: (selected: Set<TableKey>) => void,
  pageKeys?: readonly TableKey[],
  selected: Set<TableKey>,
}

/**
 * Build a controlled selection table.
 * @param options - The fixture options.
 * @returns The table element.
 */
const fixture = (options: FixtureOptions): React.ReactElement => (
  <Table
    value={PEOPLE}
    selection={{
      getRowState: options.getRowState,
      onChange: options.onChange ?? (() => undefined),
      pageKeys: options.pageKeys ?? PEOPLE.map(row => row.id),
      rowLabel: row => row.name,
      selectedKeys: options.selected,
    }}
  >
    {Column.Text({ field: 'name', title: 'Name' })}
    {Column.Text({ field: 'notes', title: 'Notes' })}
  </Table>
)

describe('Table selection', () => {
  test('a row checkbox requests a new controlled set without changing itself', async () => {
    const onChange = mock()
    const rendered = await render(fixture({ onChange, selected: new Set() }))
    const [first] = rowCheckboxes(rendered.node)

    expect(first.checked).toBe(false)
    first.click()
    await flush()

    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0][0] as Set<TableKey>
    expect([...next]).toEqual([1])
    expect(first.checked).toBe(false)

    await rendered.update(fixture({ onChange, selected: next }))
    expect(rowCheckboxes(rendered.node)[0].checked).toBe(true)
  })

  test('the header selects and clears the supplied page keys with an indeterminate state', async () => {
    const onChange = mock()
    const pageKeys = [1, 2, 3]
    const rendered = await render(fixture({ onChange, pageKeys, selected: new Set() }))

    const header = headerCheckbox(rendered.node)
    expect(header.checked).toBe(false)
    expect(header.indeterminate).toBe(false)

    header.click()
    await flush()
    expect([...(onChange.mock.calls[0][0] as Set<TableKey>)].sort()).toEqual(pageKeys)

    await rendered.update(fixture({ onChange, pageKeys, selected: new Set([1]) }))
    const partial = headerCheckbox(rendered.node)
    expect(partial.checked).toBe(false)
    expect(partial.indeterminate).toBe(true)
    expect(partial).toHaveAttribute('aria-checked', 'mixed')

    partial.click()
    await flush()
    expect([...(onChange.mock.calls[1][0] as Set<TableKey>)].sort()).toEqual(pageKeys)

    await rendered.update(fixture({ onChange, pageKeys, selected: new Set(pageKeys) }))
    headerCheckbox(rendered.node).click()
    await flush()
    expect((onChange.mock.calls[2][0] as Set<TableKey>).size).toBe(0)
  })

  test('defaults page keys to the selectable visible rows', async () => {
    const onChange = mock()
    const getRowState = (row: Person): RowSelectionState => (
      row.id === 2 ? { disabled: true } : { disabled: false }
    )
    const rendered = await render(
      <Table
        selection={{ getRowState, onChange, selectedKeys: new Set() }}
        value={PEOPLE}
      >
        {Column.Text({ field: 'name', title: 'Name' })}
      </Table>,
    )

    headerCheckbox(rendered.node).click()
    await flush()
    expect([...(onChange.mock.calls[0][0] as Set<TableKey>)].sort()).toEqual([1, 3])
  })

  test('uses page keys, not every selected key, for the header state', async () => {
    const onChange = mock()
    const rendered = await render(fixture({
      onChange,
      pageKeys: [1, 2],
      selected: new Set([2, 3]),
    }))

    const header = headerCheckbox(rendered.node)
    expect(header.checked).toBe(false)
    expect(header.indeterminate).toBe(true)

    await rendered.update(fixture({ onChange, pageKeys: [2], selected: new Set([2, 3]) }))
    expect(headerCheckbox(rendered.node).checked).toBe(true)

    await rendered.update(fixture({ onChange, pageKeys: [], selected: new Set([2, 3]) }))
    const disabled = headerCheckbox(rendered.node)
    expect(disabled.closest('label')).toHaveAttribute('disabled')
    expect(disabled.disabled).toBe(true)
    disabled.click()
    await flush()
    expect(onChange).not.toHaveBeenCalled()
  })

  test('exposes a disabled row with its reason and does not request a change', async () => {
    const onChange = mock()
    const getRowState = (row: Person): RowSelectionState => (
      row.id === 2 ? { disabled: true, reason: 'Archived' } : { disabled: false }
    )
    const rendered = await render(fixture({ getRowState, onChange, selected: new Set() }))
    const checkboxes = rowCheckboxes(rendered.node)

    expect(checkboxes[1].closest('label')).toHaveAttribute('disabled')
    expect(checkboxes[1]).toHaveAttribute('aria-label', 'Select row Grace (Archived)')
    expect(checkboxes[1].disabled).toBe(true)

    checkboxes[1].click()
    await flush()
    expect(onChange).not.toHaveBeenCalled()
  })

  test('handles zero rows with a disabled page checkbox', async () => {
    const onChange = mock()
    const rendered = await render(
      <Table
        selection={{ onChange, selectedKeys: new Set() }}
        value={[]}
      >
        {Column.Text({ field: 'name', title: 'Name' })}
      </Table>,
    )

    expect(rowCheckboxes(rendered.node)).toHaveLength(0)
    const header = headerCheckbox(rendered.node)
    expect(header.closest('label')).toHaveAttribute('disabled')
    expect(header.disabled).toBe(true)
    header.click()
    await flush()
    expect(onChange).not.toHaveBeenCalled()
  })

  test('selection updates do not rerender unrelated cell content', async () => {
    const renders = new Map<number, number>()
    const ExpensiveCell = ({ row, value }: { row: Person, value: unknown }): React.ReactElement => {
      renders.set(row.id, (renders.get(row.id) ?? 0) + 1)
      return <span>{String(value)}</span>
    }

    const table = (
      selected: Set<TableKey>,
      onChange: (keys: Set<TableKey>) => void = () => undefined,
    ): React.ReactElement => (
      <Table
        value={PEOPLE}
        selection={{
          onChange,
          pageKeys: PEOPLE.map(row => row.id),
          selectedKeys: selected,
        }}
      >
        {Column.Text({ field: 'name', title: 'Name' })}
        {Column.Text({ component: ExpensiveCell, field: 'notes', title: 'Notes' })}
      </Table>
    )

    const rendered = await render(table(new Set()))
    renders.clear()

    // Select one row, then several rows: no unrelated row cell re-renders.
    await rendered.update(table(new Set<TableKey>([1])))
    expect(renders.size).toBe(0)
    expect(rowCheckboxes(rendered.node)[0].checked).toBe(true)

    await rendered.update(table(new Set<TableKey>([1, 2, 3])))
    expect(renders.size).toBe(0)
    expect(rowCheckboxes(rendered.node).map(checkbox => checkbox.checked)).toEqual([true, true, true])
  })

  test('keeps the selection column pinned with the other pinned columns', async () => {
    const { Column: PinnedColumn, Table: PinnedTable } = TypedTable.of<Person>()
    const rendered = await render(
      <PinnedTable
        value={PEOPLE}
        selection={{
          onChange: () => undefined,
          pageKeys: PEOPLE.map(row => row.id),
          selectedKeys: new Set([1]),
        }}
      >
        {PinnedColumn.Text({ field: 'name', pin: Pin.Left, title: 'Name' })}
        {PinnedColumn.Text({ field: 'notes', title: 'Notes' })}
        {PinnedColumn.Text({ field: 'id', pin: Pin.Right, title: 'Actions' })}
      </PinnedTable>,
    )

    const headers = Array.from(rendered.node.querySelectorAll('thead th')) as HTMLTableCellElement[]
    expect(headers[0]).toHaveAttribute('data-pin', Pin.Left)
    expect(headers[1]).toHaveAttribute('data-pin', Pin.Left)
    expect(headers[3]).toHaveAttribute('data-pin', Pin.Right)
    expect(rendered.node.querySelector('tbody td')).toHaveAttribute('data-pin', Pin.Left)
  })
})
