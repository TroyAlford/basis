import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { render } from '../../testing/render'
import type { HeadCollector } from './Head'
import { Head, HeadProvider } from './Head'

describe('Head', () => {
  test('collects a title during server rendering', () => {
    const collector: HeadCollector = {}
    renderToString(
      <HeadProvider collector={collector}>
        <Head title="Server <title>" />
      </HeadProvider>,
    )

    expect(collector.title).toBe('Server <title>')
  })

  test('updates document.title after commit and on later updates', async () => {
    const application = await render(
      <HeadProvider>
        <Head title="First" />
      </HeadProvider>,
    )

    expect(document.title).toBe('First')

    await application.update(
      <HeadProvider>
        <Head title="Second" />
      </HeadProvider>,
    )
    expect(document.title).toBe('Second')

    application.unmount()
  })
})
