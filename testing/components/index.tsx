import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { AnchorPoint, Await, Mermaid, Theme, Tooltip } from '@basis/react'

/*
 * A tiny live stage for components whose meaningful state only exists after
 * mount — the resolved `Await`, the rendered `Mermaid` diagram, and the placed
 * `Tooltip`. The visual regression suite renders everything else statically; the
 * few that need a browser render here, one per path.
 */
const STAGES: Record<string, React.ReactNode> = {
  await: (
    <Await fallback={<span>Loading…</span>}>{Promise.resolve(<span>Loaded content</span>)}</Await>
  ),
  mermaid: <Mermaid>{'flowchart LR\n  A[Start] --> B[End]'}</Mermaid>,
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
