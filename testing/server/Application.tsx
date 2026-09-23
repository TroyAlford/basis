import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { ApplicationBase } from '@basis/react'

/** A minimal managed application used to exercise the server modes. */
export class Application extends ApplicationBase {
  layout(content: React.ReactNode): React.ReactNode {
    return (
      <main data-testid="application">
        Basis managed server
        {content}
      </main>
    )
  }
}

const root = document.getElementById('root')
if (root) createRoot(root).render(<Application />)
