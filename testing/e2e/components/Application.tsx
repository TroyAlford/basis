import { ApplicationBase, Link } from 'basis/react'
import * as React from 'react'

import './Application.styles.ts'

export class Application extends ApplicationBase {
  layout(content: React.ReactNode) {
    return (
      <>
        <header>
          <h1>Application</h1>
          <nav>
            <Link to="/foo/123">Foo</Link>
            <Link to="/bar/234">Bar</Link>
            <Link to="/baz/345">Qux</Link>
          </nav>
        </header>
        <main>
          {/* A deterministic, text-free target for application-level snapshots. */}
          <div data-testid="swatch" style={{ background: '#137cbd', height: 32, width: 32 }} />
          {content}
        </main>
      </>
    )
  }
}
