import { ApplicationBase, Head } from 'basis/react'
import * as React from 'react'

/** A minimal managed application used to exercise the server lifecycle. */
export class Application extends ApplicationBase {
  layout(content: React.ReactNode): React.ReactNode {
    return (
      <>
        <Head title="Basis fixture" />
        <main data-testid="application">Basis managed server{content}</main>
      </>
    )
  }
}
