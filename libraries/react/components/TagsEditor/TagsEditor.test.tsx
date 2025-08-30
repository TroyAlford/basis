import { beforeEach, describe, expect, mock, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { Simulate } from '../../testing/Simulate'
import { TagsEditor } from './TagsEditor'

describe('TagsEditor', () => {
  const getInput = (container: ParentNode) => (
    container.querySelector<HTMLInputElement | HTMLTextAreaElement>('.text-editor.component .value')
  )
  const getTags = (container: ParentNode) => container.querySelectorAll('.tag.component')
  const getRemoveButtons = (container: ParentNode) => container.querySelectorAll('.remove')

  // Shared mocks
  let onChange: ReturnType<typeof mock>

  beforeEach(() => {
    onChange = mock()
  })

  describe('rendering', () => {
    test('renders empty state correctly', async () => {
      const { node } = await render(<TagsEditor onChange={onChange} />)

      expect(getTags(node)).toHaveLength(0)
      expect(getInput(node)).toBeTruthy()
    })

    test('renders tags correctly', async () => {
      const tags = ['tag1', 'tag2', 'tag3']
      const { node } = await render(<TagsEditor value={tags} onChange={onChange} />)

      const tagElements = getTags(node)
      expect(tagElements).toHaveLength(3)

      tagElements.forEach((tag, index) => {
        expect(tag).toHaveTextContent(tags[index])
      })
    })

    test('renders in read-only mode', async () => {
      const tags = ['tag1', 'tag2']
      const { node } = await render(<TagsEditor readOnly value={tags} onChange={onChange} />)

      const component = node as Element
      expect(component).toHaveAttribute('data-readonly', 'true')
      expect(getTags(node)).toHaveLength(2)
      expect(getInput(node)).toBeFalsy()
    })

    test('renders with custom placeholder', async () => {
      const { node } = await render(<TagsEditor placeholder="Custom placeholder" onChange={onChange} />)

      const input = getInput(node)
      expect(input).toHaveAttribute('placeholder', 'Custom placeholder')
    })

    test('renders with icon', async () => {
      const icon = <span data-testid="icon">🎯</span>
      const { node } = await render(<TagsEditor icon={icon} onChange={onChange} />)

      const iconElement = node.querySelector('[data-testid="icon"]')
      expect(iconElement).toBeTruthy()
    })
  })

  describe('interactions', () => {
    test('adds tag on Enter key', async () => {
      const { node } = await render(<TagsEditor onChange={onChange} />)
      const input = getInput(node)

      await Simulate.change(input, 'new-tag')
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
      await Promise.resolve()

      expect(onChange).toHaveBeenCalledWith(['new-tag'], '', expect.any(Object))
    })

    test('clears input on Escape key', async () => {
      const { node } = await render(<TagsEditor onChange={onChange} />)
      const input = getInput(node)

      await Simulate.change(input, 'test')
      expect(input.value).toBe('test')

      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
      await Promise.resolve()
      expect(input.value).toBe('')
    })

    test('removes tag when remove button is clicked', async () => {
      const tags = ['tag1', 'tag2', 'tag3']
      const { node } = await render(<TagsEditor value={tags} onChange={onChange} />)

      const removeButtons = getRemoveButtons(node)
      expect(removeButtons).toHaveLength(3)

      // Simulate click by dispatching a click event
      removeButtons[0].dispatchEvent(new Event('click', { bubbles: true }))
      await Promise.resolve()

      expect(onChange).toHaveBeenCalledWith(['tag2', 'tag3'], '', expect.any(Object))
    })

    test('does not add empty tags', async () => {
      const { node } = await render(<TagsEditor onChange={onChange} />)
      const input = getInput(node)

      await Simulate.change(input, '   ')
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
      await Promise.resolve()

      expect(onChange).not.toHaveBeenCalled()
    })

    test('does not add denied tags', async () => {
      const deny = ['denied-tag']
      const { node } = await render(<TagsEditor deny={deny} onChange={onChange} />)
      const input = getInput(node)

      await Simulate.change(input, 'denied-tag')
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
      await Promise.resolve()

      expect(onChange).not.toHaveBeenCalled()
    })

    test('deduplicates tags', async () => {
      const tags = ['existing-tag']
      const { node } = await render(<TagsEditor value={tags} onChange={onChange} />)
      const input = getInput(node)

      await Simulate.change(input, 'existing-tag')
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
      await Promise.resolve()

      // The Editor's handleChange does deep equality check, so it won't call onChange if the value is the same
      expect(onChange).not.toHaveBeenCalled()
    })

    test('slugifies tags', async () => {
      const { node } = await render(<TagsEditor onChange={onChange} />)
      const input = getInput(node)

      await Simulate.change(input, 'Tag With Spaces')
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
      await Promise.resolve()

      expect(onChange).toHaveBeenCalledWith(['tag-with-spaces'], '', expect.any(Object))
    })
  })
})
