import { render, waitFor } from 'basis/testing'
import { expect, test } from 'bun:test'
import { Hello } from './Hello.tsx'

test('renders the walkthrough greeting', async () => {
  const { node } = await render(<Hello name="Basis" />)
  expect(node.textContent).toContain('Hello, Basis!')
})

test('mounts Hello through the walkthrough application entrypoint', async () => {
  document.body.innerHTML = '<div id="root"></div>'
  await import('./Application.tsx')
  await waitFor(() => document.body.textContent?.includes('Hello, Basis!'))
})
