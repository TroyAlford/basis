import { Button, TypedTable } from 'basis/react'
import type * as React from 'react'
import { matchScreenshot, test } from '../../../testing'

interface Row {
  action: string,
  id: number,
  quantity: number,
  role: string,
  title: string,
}

const ROWS: Row[] = [
  { action: 'Open', id: 1, quantity: 1234.5, role: 'admin', title: 'Alpha' },
  { action: 'Open', id: 2, quantity: 42, role: 'viewer', title: 'Bravo' },
]

/** Enum options are keyed by display label; the row stores the value. */
const ROLES: Record<string, string> = { Administrator: 'admin', Viewer: 'viewer' }

const { Column, Table } = TypedTable.of<Row>()

/**
 * A custom component cell, like the `Button` cells the issue calls out.
 * @param props - The cell props.
 * @param props.value - The value shown on the button.
 * @returns The rendered button.
 */
const ActionCell = (props: { value: unknown }): React.ReactNode => <Button>{String(props.value)}</Button>

/**
 * Vertical alignment of every cell flavor the issue names: editor-backed
 * text/enum/number cells plus a custom `Button` component cell, at the
 * reproduction's fixed row height and again with a taller row so any
 * off-center content is obvious.
 *
 * `th`/`td` use the browser's default `vertical-align: middle`, and the editor
 * roots center their own value, so all four flavors share one baseline without
 * consumer CSS. These snapshots pin that.
 */
test('vertically centers text, enum, number, and component cells', async () => {
  const table = (rowHeight: string): React.ReactElement => (
    <div style={{ '--basis-table-row-height': rowHeight, 'width': '36em' } as React.CSSProperties}>
      <Table value={ROWS}>
        {Column.Text({ field: 'title', title: 'Title' })}
        {Column.Enum({ enum: ROLES, field: 'role', title: 'Role' })}
        {Column.Number({ field: 'quantity', title: 'Quantity' })}
        {Column.Text({ component: ActionCell, field: 'action', title: 'Action' })}
      </Table>
    </div>
  )

  await matchScreenshot(table('2em'))
  await matchScreenshot(table('4em'))
})
