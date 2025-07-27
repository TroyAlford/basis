import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { Switch } from './Switch'

describe('Switch', () => {
  test('renders only the first valid child', async () => {
    const { node } = await render<Switch>(
      <Switch>
        <div>First</div>
        <div>Second</div>
        <div>Third</div>
      </Switch>,
    )
    const firstChild = node.firstChild as HTMLElement
    expect(firstChild.textContent).toBe('First')
  })

  test('handles no valid children', async () => {
    const { node } = await render<Switch>(
      <Switch>
        {null}
        {undefined}
        {false}
      </Switch>,
    )
    // When no valid children, the Fragment should still render but be empty
    expect(node?.textContent ?? '').toBe('')
  })
})
