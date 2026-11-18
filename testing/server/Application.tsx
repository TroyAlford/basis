import { ApplicationBase } from 'basis/react'
import * as React from 'react'

/** A minimal managed application used to exercise the server lifecycle. */
export class Application extends ApplicationBase {
  layout(content: React.ReactNode): React.ReactNode {
    return (
      <main data-testid="application">Basis managed server{content}</main>
    )
  }
}
