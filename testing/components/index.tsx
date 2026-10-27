import { AnchorPoint, Await, Mermaid, Pin, Theme, Tooltip, TypedTable } from 'basis/react'
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { OverlayStage } from './OverlayStage'

/*
 * A tiny live stage for components whose meaningful state only exists after
 * mount — the resolved `Await`, the rendered `Mermaid` diagram, the placed
 * `Tooltip`, and a scrollable table. The visual regression suite renders
 * everything else statically; the few that need a browser render here, one per
 * path.
 */
interface TableRow {
  actions: string,
  id: number,
  name: string,
  value: string,
}

const TABLE_ROWS: TableRow[] = Array.from({ length: 30 }, (_, index) => ({
  actions: `Action ${index}`,
  id: index,
  name: `Row ${index}`,
  value: `Value ${index}`,
}))

const { Column, Table } = TypedTable.of<TableRow>()

const STAGES: Record<string, React.ReactNode> = {
  await: (
    <Await fallback={<span>Loading…</span>}>{Promise.resolve(<span>Loaded content</span>)}</Await>
  ),
  mermaid: <Mermaid>{'flowchart LR\n  A[Start] --> B[End]'}</Mermaid>,
  overlay: <OverlayStage />,
  table: (
    <div style={{ padding: 24 }}>
      <Table readOnly style={{ maxHeight: '9em', overflow: 'auto', width: '26em' }} value={TABLE_ROWS}>
        {Column.Text({ field: 'name', pin: Pin.Left, title: 'Name' })}
        {Column.Text({ field: 'value', title: 'Value' })}
        {Column.Text({ field: 'actions', pin: Pin.Right, title: 'Actions' })}
      </Table>
    </div>
  ),
  tooltip: (
    <div style={{ display: 'inline-block', padding: 80 }}>
      <div style={{ display: 'inline-block', height: 40, position: 'relative', width: 120 }}>
        <Tooltip visible anchorPoint={AnchorPoint.Top}>Tooltip content</Tooltip>
      </div>
    </div>
  ),
}

const path = window.location.pathname.replace(/^\/+/, '') || 'await'
const stage = STAGES[path] ?? <span>Unknown component: {path}</span>
const container = document.getElementById('root')

if (container) {
  createRoot(container).render(
    <>
      <Theme />
      <div id="stage" style={{ background: '#fff', display: 'inline-block', padding: 24 }}>{stage}</div>
    </>,
  )
}
