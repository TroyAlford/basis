import { describe, expect, mock, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { Pin } from '../../types/Pin'
import type { TableKey, TableState } from './Selection'
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
 * The header's Select All checkbox.
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

/**
 * The row checkbox for a named row.
 * @param node - The rendered table.
 * @param name - The row name.
 * @returns The checkbox input.
 */
const rowCheckboxFor = (node: HTMLElement, name: string): HTMLInputElement => {
  const row = Array.from(node.querySelectorAll('tbody tr'))
    .find(element => element.textContent?.includes(name)) as HTMLTableRowElement

  return row.querySelector('input[type="checkbox"]') as HTMLInputElement
}

interface FixtureOptions {
  enableRowSelection?: boolean,
  keyField?: 'id' | 'name',
  onStateChange?: (state: TableState) => void,
  readOnly?: boolean,
  selectedRows?: Iterable<TableKey>,
  value?: Person[],
}

/**
 * Build a controlled selection table.
 * @param options - The fixture options.
 * @returns The table element.
 */
const fixture = (options: FixtureOptions = {}): React.ReactElement => (
  <Table
    enableRowSelection={options.enableRowSelection ?? true}
    keyField={options.keyField}
    readOnly={options.readOnly}
    selectedRows={options.selectedRows ?? []}
    value={options.value ?? PEOPLE}
    onStateChange={options.onStateChange ?? (() => undefined)}
  >
    {Column.Text({ field: 'name', title: 'Name' })}
    {Column.Text({ field: 'notes', title: 'Notes' })}
  </Table>
)

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { message: string | null }
> {
  state = { message: null as string | null }

  static getDerivedStateFromError(error: unknown): { message: string } {
    return { message: error instanceof Error ? error.message : String(error) }
  }

  render(): React.ReactNode {
    return this.state.message
      ? <div data-error>{this.state.message}</div>
      : this.props.children
  }
}

describe('Table selection', () => {
  test('is absent by default and renders one pinned, nonsortable checkbox column when enabled', async () => {
    const plain = await render(fixture({ enableRowSelection: false, selectedRows: undefined }))
    expect(plain.node.querySelector('th[data-field="__selection__"]')).toBeNull()
    expect(rowCheckboxes(plain.node)).toHaveLength(0)

    const { Column: PinnedColumn, Table: PinnedTable } = TypedTable.of<Person>()
    const rendered = await render(
      <PinnedTable
        enableRowSelection
        keyField="id"
        selectedRows={[]}
        value={PEOPLE}
        onStateChange={() => undefined}
      >
        {PinnedColumn.Text({ field: 'name', pin: Pin.Left, title: 'Name' })}
        {PinnedColumn.Text({ field: 'notes', title: 'Notes' })}
        {PinnedColumn.Text({ field: 'id', pin: Pin.Right, title: 'Actions' })}
      </PinnedTable>,
    )

    const headers = Array.from(rendered.node.querySelectorAll('thead th')) as HTMLTableCellElement[]
    expect(headers).toHaveLength(4)
    expect(headers[0]).toHaveAttribute('data-field', '__selection__')
    expect(headers[0]).toHaveAttribute('data-pin', Pin.Left)
    expect(headers[0]).toHaveAttribute('data-sortable', 'false')
    expect(headers[0].querySelector('.sort')).toBeNull()
    expect(headers[0].textContent).toBe('')
    expect(headers[0].querySelector('input')).toHaveAttribute('aria-label', 'Select all rows')
    expect(headers[1]).toHaveAttribute('data-pin', Pin.Left)
    expect(headers[3]).toHaveAttribute('data-pin', Pin.Right)
  })

  test('accepts Set and array state, emits a fresh Set, and stays controlled until updated', async () => {
    const onStateChange = mock()
    const original = new Set<TableKey>([2])
    const rendered = await render(fixture({ onStateChange, selectedRows: original }))
    const first = rowCheckboxes(rendered.node)[0]

    expect(first.checked).toBe(false)
    first.click()
    await flush()

    expect(onStateChange).toHaveBeenCalledTimes(1)
    const state = onStateChange.mock.calls[0][0] as TableState
    expect(state.selectedRows).toBeInstanceOf(Set)
    expect(state.selectedRows).not.toBe(original)
    expect([...original]).toEqual([2])
    expect([...state.selectedRows].sort()).toEqual([1, 2])
    expect(first.checked).toBe(false)

    await rendered.update(fixture({ onStateChange, selectedRows: state.selectedRows }))
    expect(rowCheckboxes(rendered.node)[0].checked).toBe(true)
    expect(rowCheckboxes(rendered.node)[1].checked).toBe(true)

    const arrayRendered = await render(fixture({ onStateChange, selectedRows: [1] }))
    expect(rowCheckboxes(arrayRendered.node)[0].checked).toBe(true)
  })

  test('transitions none to all, partial to all, and all to none while preserving outside keys', async () => {
    const onStateChange = mock()
    const rendered = await render(fixture({ onStateChange, selectedRows: [] }))

    const header = headerCheckbox(rendered.node)
    expect(header.checked).toBe(false)
    expect(header.indeterminate).toBe(false)

    header.click()
    await flush()
    expect([...(onStateChange.mock.calls[0][0] as TableState).selectedRows].sort()).toEqual([1, 2, 3])

    await rendered.update(fixture({ onStateChange, selectedRows: [1] }))
    const partial = headerCheckbox(rendered.node)
    expect(partial.checked).toBe(false)
    expect(partial.indeterminate).toBe(true)
    expect(partial).toHaveAttribute('aria-checked', 'mixed')

    partial.click()
    await flush()
    expect([...(onStateChange.mock.calls[1][0] as TableState).selectedRows].sort()).toEqual([1, 2, 3])

    await rendered.update(fixture({ onStateChange, selectedRows: [1, 2, 3, 99] }))
    expect(headerCheckbox(rendered.node).checked).toBe(true)
    headerCheckbox(rendered.node).click()
    await flush()
    expect([...(onStateChange.mock.calls[2][0] as TableState).selectedRows]).toEqual([99])
  })

  test('disables an empty table header and never calls back', async () => {
    const onStateChange = mock()
    const rendered = await render(fixture({ onStateChange, selectedRows: [], value: [] }))

    expect(rowCheckboxes(rendered.node)).toHaveLength(0)
    const header = headerCheckbox(rendered.node)
    expect(header.checked).toBe(false)
    expect(header.disabled).toBe(true)
    header.click()
    await flush()
    expect(onStateChange).not.toHaveBeenCalled()
  })

  test('requires controlled selection props when enabled', async () => {
    const missingState = await render(
      <ErrorBoundary>
        <Table enableRowSelection value={PEOPLE}>
          {Column.Text({ field: 'name', title: 'Name' })}
        </Table>
      </ErrorBoundary>,
    )
    expect(missingState.node).toHaveAttribute('data-error')
    expect(missingState.node.textContent).toContain('requires selectedRows')

    const missingCallback = await render(
      <ErrorBoundary>
        <Table enableRowSelection selectedRows={[]} value={PEOPLE}>
          {Column.Text({ field: 'name', title: 'Name' })}
        </Table>
      </ErrorBoundary>,
    )
    expect(missingCallback.node).toHaveAttribute('data-error')
    expect(missingCallback.node.textContent).toContain('requires onStateChange')
  })

  test('preserves selected identities through sorting and reorders the aggregate state', async () => {
    const rendered = await render(fixture({ selectedRows: [2] }))
    const nameHeader = rendered.node.querySelector('th[data-field="name"]') as HTMLTableCellElement

    nameHeader.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flush()
    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending')
    expect(rowCheckboxFor(rendered.node, 'Grace').checked).toBe(true)
    expect(headerCheckbox(rendered.node).indeterminate).toBe(true)

    nameHeader.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flush()
    expect(nameHeader).toHaveAttribute('aria-sort', 'descending')
    expect(rowCheckboxFor(rendered.node, 'Grace').checked).toBe(true)

    await rendered.update(fixture({ selectedRows: [2], value: [PEOPLE[1]] }))
    expect(headerCheckbox(rendered.node).checked).toBe(true)
    expect(rowCheckboxes(rendered.node)[0].checked).toBe(true)

    await rendered.update(fixture({ selectedRows: [2], value: [PEOPLE[0]] }))
    expect(headerCheckbox(rendered.node).checked).toBe(false)
    expect(rowCheckboxes(rendered.node)[0].checked).toBe(false)
  })

  test('uses canonical keys, preserves numeric zero, and rejects invalid keys', async () => {
    const onStateChange = mock()
    const zero = await render(fixture({
      onStateChange,
      selectedRows: [],
      value: [{ id: 0, name: 'Zero', notes: '' }],
    }))
    expect(rowCheckboxes(zero.node)[0]).toHaveAttribute('aria-label', 'Select row 0')
    expect(zero.node.querySelector('tbody tr')).not.toBeNull()

    rowCheckboxes(zero.node)[0].click()
    await flush()
    expect([...(onStateChange.mock.calls[0][0] as TableState).selectedRows]).toEqual([0])

    interface NestedRow {
      meta: { key: string },
      name: string,
    }
    const { Column: NestedColumn, Table: NestedTable } = TypedTable.of<NestedRow>()
    const nested = await render(
      <NestedTable
        enableRowSelection
        keyField="meta.key"
        selectedRows={[]}
        value={[{ meta: { key: 'alpha' }, name: 'Alpha' }]}
        onStateChange={() => undefined}
      >
        {NestedColumn.Text({ field: 'name', title: 'Name' })}
      </NestedTable>,
    )
    expect(rowCheckboxes(nested.node)[0]).toHaveAttribute('aria-label', 'Select row alpha')

    interface BadRow { id?: null | boolean | number, name: string }
    const { Column: BadColumn, Table: BadTable } = TypedTable.of<BadRow>()
    const badTable = (id: BadRow['id'], enableRowSelection: boolean): React.ReactElement => (
      <ErrorBoundary>
        <BadTable
          enableRowSelection={enableRowSelection}
          selectedRows={enableRowSelection ? [] : undefined}
          value={[{ id, name: 'Bad' }]}
          onStateChange={enableRowSelection ? () => undefined : undefined}
        >
          {BadColumn.Text({ field: 'name', title: 'Name' })}
        </BadTable>
      </ErrorBoundary>
    )

    for (const id of [null, false, true]) {
      const error = await render(badTable(id, false))
      expect(error.node).toHaveAttribute('data-error')
      expect(error.node.textContent).toContain('must resolve to a string or number')
    }

    const missing = await render(
      <ErrorBoundary>
        <BadTable enableRowSelection selectedRows={[]} value={[{ name: 'Missing' }]} onStateChange={() => undefined}>
          {BadColumn.Text({ field: 'name', title: 'Name' })}
        </BadTable>
      </ErrorBoundary>,
    )
    expect(missing.node).toHaveAttribute('data-error')
    expect(missing.node.textContent).toContain('required for row selection')

    const legacy = await render(
      <BadTable selectedRows={undefined} value={[{ name: 'Legacy' }]}>
        {BadColumn.Text({ field: 'name', title: 'Name' })}
      </BadTable>,
    )
    expect(legacy.node.querySelector('tbody tr')).not.toBeNull()
  })

  test('does not equate numeric zero with the string "0"', async () => {
    interface MixedRow {
      id: number | string,
      name: string,
    }
    const { Column: MixedColumn, Table: MixedTable } = TypedTable.of<MixedRow>()
    const onStateChange = mock()
    const table = (selectedRows: Iterable<TableKey>): React.ReactElement => (
      <MixedTable
        enableRowSelection
        selectedRows={selectedRows}
        value={[{ id: 0, name: 'Numeric' }, { id: '0', name: 'String' }]}
        onStateChange={onStateChange}
      >
        {MixedColumn.Text({ field: 'name', title: 'Name' })}
      </MixedTable>
    )

    const rendered = await render(table([]))
    rowCheckboxes(rendered.node)[0].click()
    await flush()
    const first = (onStateChange.mock.calls[0][0] as TableState).selectedRows
    expect([...first]).toEqual([0])

    await rendered.update(table(first))
    rowCheckboxes(rendered.node)[1].click()
    await flush()
    const both = (onStateChange.mock.calls[1][0] as TableState).selectedRows
    expect(both.size).toBe(2)
    expect(both.has(0)).toBe(true)
    expect(both.has('0')).toBe(true)
  })

  test('never triggers sorting from a selection checkbox keydown', async () => {
    const rendered = await render(fixture({ selectedRows: [] }))
    const selection = rowCheckboxes(rendered.node)[0]
    const nameHeader = rendered.node.querySelector('th[data-field="name"]') as HTMLTableCellElement

    selection.focus()
    selection.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ' }))
    await flush()

    expect(nameHeader).toHaveAttribute('aria-sort', 'none')
    expect(nameHeader).not.toHaveAttribute('data-sort-direction')
  })

  test('keeps expensive cells untouched during one-row and select-all updates', async () => {
    const renders = new Map<string, number>()
    const ExpensiveCell = ({ row, value }: { row: Person, value: unknown }): React.ReactElement => {
      renders.set(row.name, (renders.get(row.name) ?? 0) + 1)
      return <span>{String(value)}</span>
    }

    const table = (
      selectedRows: Iterable<TableKey>,
      onStateChange: (state: TableState) => void = () => undefined,
    ): React.ReactElement => (
      <Table
        enableRowSelection
        keyField="id"
        selectedRows={selectedRows}
        value={PEOPLE}
        onStateChange={onStateChange}
      >
        {Column.Text({ field: 'name', pin: Pin.Left, title: 'Name' })}
        {Column.Text({ component: ExpensiveCell, field: 'notes', title: 'Notes' })}
        {Column.Text({ field: 'id', pin: Pin.Right, title: 'Actions' })}
      </Table>
    )

    const rendered = await render(table([]))
    const nameHeader = rendered.node.querySelector('th[data-field="name"]') as HTMLTableCellElement
    nameHeader.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flush()
    renders.clear()

    await rendered.update(table([1]))
    expect(renders.size).toBe(0)
    expect(rowCheckboxes(rendered.node)[0].checked).toBe(true)

    await rendered.update(table([1, 2, 3]))
    expect(renders.size).toBe(0)
    expect(rowCheckboxes(rendered.node).map(checkbox => checkbox.checked)).toEqual([true, true, true])
  })

  test('selects rows on a readOnly table and still sorts a rich header', async () => {
    const onStateChange = mock()
    const { Column: RichColumn, Table: RichTable } = TypedTable.of<Person>()
    const rendered = await render(
      <RichTable
        enableRowSelection
        readOnly
        selectedRows={[]}
        value={PEOPLE}
        onStateChange={onStateChange}
      >
        {RichColumn.Text({
          field: 'name',
          title: (
            <>
              <span>Name</span>
              <button type="button">Act</button>
            </>
          ),
        })}
        {RichColumn.Text({ field: 'notes', title: 'Notes' })}
      </RichTable>,
    )

    const header = rendered.node.querySelector('th[data-field="name"]') as HTMLTableCellElement;
    (header.querySelector('.title > span') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flush()
    expect(header).toHaveAttribute('aria-sort', 'ascending')

    rowCheckboxes(rendered.node)[0].click()
    await flush()
    expect((onStateChange.mock.calls[0][0] as TableState).selectedRows).toEqual(new Set([1]))
  })
})
