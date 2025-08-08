import { describe, expect, mock, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { Tag } from './Tag'

describe('Tag', () => {
  describe('rendering', () => {
    test('renders children content', async () => {
      const { node } = await render(<Tag>Test Tag</Tag>)
      expect(node.textContent).toContain('Test Tag')
    })

    test('renders with default props', async () => {
      const { node } = await render(<Tag>Default Tag</Tag>)
      expect(node).toHaveClass('tag', 'component')
      expect(node).toHaveAttribute('data-removable', 'false')
    })

    test('renders remove button when removable is true', async () => {
      const { node } = await render(<Tag removable>Removable Tag</Tag>)
      const removeButton = node.querySelector('a.remove[aria-label="Remove tag"]')
      expect(removeButton).toBeTruthy()
      expect(removeButton?.textContent).toBe('×')
    })

    test('does not render remove button when removable is false', async () => {
      const { node } = await render(<Tag removable={false}>Non-removable Tag</Tag>)
      const removeButton = node.querySelector('a.remove[aria-label="Remove tag"]')
      expect(removeButton).toBeFalsy()
    })

    test('renders complex children', async () => {
      const { node } = await render(
        <Tag>
          <span>Icon</span>
          <strong>Bold Text</strong>
        </Tag>,
      )
      expect(node.textContent).toContain('Icon')
      expect(node.textContent).toContain('Bold Text')
    })

    test('applies custom className', async () => {
      const { node } = await render(<Tag className="custom-class">Custom Tag</Tag>)
      expect(node).toHaveClass('custom-class')
    })
  })

  describe('event handling', () => {
    test('calls onRemove when remove button is clicked', async () => {
      const onRemove = mock()
      const { node } = await render(<Tag removable onRemove={onRemove}>Clickable Tag</Tag>)

      const removeButton = node.querySelector('a.remove[aria-label="Remove tag"]') as HTMLAnchorElement
      removeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

      expect(onRemove).toHaveBeenCalledTimes(1)
    })

    test('prevents event propagation when remove button is clicked', async () => {
      const onRemove = mock()
      const onParentClick = mock()

      const { node } = await render(
        <div onClick={onParentClick}>
          <Tag removable onRemove={onRemove}>Event Tag</Tag>
        </div>,
      )

      const removeButton = node.querySelector('a.remove[aria-label="Remove tag"]') as HTMLAnchorElement
      removeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

      expect(onRemove).toHaveBeenCalledTimes(1)
      expect(onParentClick).not.toHaveBeenCalled()
    })
  })
})
