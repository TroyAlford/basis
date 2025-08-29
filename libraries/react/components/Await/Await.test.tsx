import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { Await } from './Await'

describe('Await', () => {
  describe('rendering', () => {
    test('renders fallback initially', async () => {
      const { node } = await render(
        <Await fallback={<div>Loading...</div>}>
          {Promise.resolve(<div>Content loaded!</div>)}
        </Await>,
      )
      expect(node.textContent).toBe('Loading...')
    })

    test('renders resolved content after promise resolves', async () => {
      const promise = Promise.resolve(<div>Content loaded!</div>)
      const { node } = await render(
        <Await fallback={<div>Loading...</div>}>
          {promise}
        </Await>,
      )

      // Wait for the promise to resolve and React to re-render
      await promise
      await new Promise(resolve => setTimeout(resolve, 100))

      expect(node.textContent).toBe('Content loaded!')
    })

    test('renders fallback with complex content', async () => {
      const { node } = await render(
        <Await fallback={<div><span>Loading</span> <strong>content</strong></div>}>
          {Promise.resolve(<div>Final content</div>)}
        </Await>,
      )

      expect(node.querySelector('span')).toBeTruthy()
      expect(node.querySelector('strong')).toBeTruthy()
      expect(node.textContent).toBe('Loading content')
    })
  })

  describe('promise handling', () => {
    test('handles immediate promise resolution', async () => {
      const promise = Promise.resolve(<div>Immediate</div>)
      const { node } = await render(
        <Await fallback={<div>Loading...</div>}>
          {promise}
        </Await>,
      )

      await promise
      await new Promise(resolve => setTimeout(resolve, 100))

      expect(node.textContent).toBe('Immediate')
    })

    test('handles delayed promise resolution', async () => {
      const promise = new Promise<React.ReactNode>(resolve => {
        setTimeout(() => resolve(<div>Delayed</div>), 10)
      })

      const { node } = await render(
        <Await fallback={<div>Loading...</div>}>
          {promise}
        </Await>,
      )

      // Should show fallback initially
      expect(node.textContent).toBe('Loading...')

      // Wait for promise to resolve
      await promise
      await new Promise(resolve => setTimeout(resolve, 100))

      expect(node.textContent).toBe('Delayed')
    })
  })

  describe('fallback behavior', () => {
    test('renders fallback while promise is pending', async () => {
      const promise = new Promise<React.ReactNode>(() => {
        // Never resolve
      })

      const { node } = await render(
        <Await fallback={<div>Custom fallback</div>}>
          {promise}
        </Await>,
      )

      expect(node.textContent).toBe('Custom fallback')
    })

    test('renders fallback with custom component', async () => {
      const CustomFallback = () => <div>Custom component fallback</div>

      const { node } = await render(
        <Await fallback={<CustomFallback />}>
          {Promise.resolve(<div>Content</div>)}
        </Await>,
      )

      expect(node.textContent).toBe('Custom component fallback')
    })

    test('renders fallback with props', async () => {
      const CustomFallback = ({ message }: { message: string }) => (
        <div>Fallback: {message}</div>
      )

      const { node } = await render(
        <Await fallback={<CustomFallback message="Loading data" />}>
          {Promise.resolve(<div>Content</div>)}
        </Await>,
      )

      expect(node.textContent).toBe('Fallback: Loading data')
    })
  })

  describe('debugging', () => {
    test('debug: check if component updates after promise resolves', async () => {
      const promise = Promise.resolve(<div>Debug content</div>)
      const { instance, node } = await render<Await>(
        <Await fallback={<div>Loading...</div>}>
          {promise}
        </Await>,
      )

      // Check initial state
      expect(instance.state.loaded).toBe(false)
      expect(node.textContent).toBe('Loading...')

      // Wait for promise to resolve
      await promise
      await new Promise(resolve => setTimeout(resolve, 100))

      // Check if state was updated
      expect(instance.state.loaded).toBe(true)
      expect(instance.state.children).toBeTruthy()

      // Check if DOM was updated
      expect(node.textContent).toBe('Debug content')
    })
  })
})
