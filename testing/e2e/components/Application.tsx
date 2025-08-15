import * as React from 'react'
import { ApplicationBase, Link } from '@basis/react'

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
          {content}
        </main>
      </>
    )
  }
}
