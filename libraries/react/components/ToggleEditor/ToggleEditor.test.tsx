import { describe, expect, mock, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { ToggleEditor } from './ToggleEditor'

describe('ToggleEditor', () => {
  describe('rendering', () => {
    test('renders with default props', async () => {
      const { node } = await render(<ToggleEditor onChange={() => undefined} />)

      expect(node.tagName).toBe('BUTTON')
      expect(node).toHaveClass('toggle-editor', 'component', 'editor', 'toggle')
      expect(node).toHaveAttribute('data-state', 'off')
      expect(node).toHaveAttribute('aria-pressed', 'false')
      expect(node.textContent).toBe('Off')
    })

    test('renders in on state', async () => {
      const { node } = await render(<ToggleEditor value={true} onChange={() => undefined} />)

      expect(node).toHaveClass('toggle-editor', 'component', 'editor', 'toggle')
      expect(node).toHaveAttribute('data-state', 'on')
      expect(node).toHaveAttribute('aria-pressed', 'true')
      expect(node.textContent).toBe('On')
    })

    test('renders with custom content', async () => {
      const { node } = await render(<ToggleEditor off="Custom Off" on="Custom On" onChange={() => undefined} />)

      expect(node.textContent).toBe('Custom Off')
    })

    test('renders with custom on icon', async () => {
      const CustomIcon = <svg data-testid="custom-icon" />
      const { node } = await render(<ToggleEditor on={CustomIcon} value={true} onChange={() => undefined} />)

      const icon = node.querySelector('[data-testid="custom-icon"]')
      expect(icon).toBeTruthy()
    })

    test('renders with different on/off icons', async () => {
      const OnIcon = <svg data-testid="on-icon" />
      const OffIcon = <svg data-testid="off-icon" />

      const { node: offNode } = await render(
        <ToggleEditor off={OffIcon} on={OnIcon} value={false} onChange={() => undefined} />,
      )
      expect(offNode.querySelector('[data-testid="off-icon"]')).toBeTruthy()

      const { node: onNode } = await render(
        <ToggleEditor off={OffIcon} on={OnIcon} value={true} onChange={() => undefined} />,
      )
      expect(onNode.querySelector('[data-testid="on-icon"]')).toBeTruthy()
    })

    test('renders in read-only mode', async () => {
      const { node } = await render(<ToggleEditor readOnly={true} onChange={() => undefined} />)

      expect(node).toHaveClass('toggle-editor', 'component', 'editor', 'toggle')
      expect(node).toHaveAttribute('tabIndex', '-1')
      expect(node).toHaveAttribute('disabled', '')
      expect(node).toHaveAttribute('readOnly', '')
    })
  })

  describe('event handling', () => {
    test('calls onChange when clicked', async () => {
      const onChange = mock()
      const { node } = await render(<ToggleEditor value={false} onChange={onChange} />)

      node.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith(true, '', expect.any(Object))
    })

    test('toggles value on click', async () => {
      const onChange = mock()
      const { node } = await render(<ToggleEditor value={true} onChange={onChange} />)

      node.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith(false, '', expect.any(Object))
    })

    test('calls onChange on Space key', async () => {
      const onChange = mock()
      const { node } = await render(<ToggleEditor value={false} onChange={onChange} />)

      node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ' }))
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith(true, '', expect.any(Object))
    })

    test('calls onChange on Enter key', async () => {
      const onChange = mock()
      const { node } = await render(<ToggleEditor value={false} onChange={onChange} />)

      node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith(true, '', expect.any(Object))
    })

    test('does not call onChange when read-only', async () => {
      const onChange = mock()
      const { node } = await render(<ToggleEditor readOnly={true} onChange={onChange} />)

      node.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(onChange).not.toHaveBeenCalled()
    })

    test('does not call onChange on other keys', async () => {
      const onChange = mock()
      const { node } = await render(<ToggleEditor value={false} onChange={onChange} />)

      node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Tab' }))
      expect(onChange).not.toHaveBeenCalled()
    })
  })

  describe('controlled vs uncontrolled', () => {
    test('handles controlled mode', async () => {
      const onChange = mock()
      const { node } = await render(<ToggleEditor value={true} onChange={onChange} />)

      expect(node).toHaveAttribute('aria-pressed', 'true')
      expect(node).toHaveAttribute('data-state', 'on')
    })

    test('handles uncontrolled mode', async () => {
      const onChange = mock()
      const { node } = await render(<ToggleEditor initialValue={true} onChange={onChange} />)

      expect(node).toHaveAttribute('aria-pressed', 'true')
      expect(node).toHaveAttribute('data-state', 'on')
    })
  })

  describe('accessibility', () => {
    test('has proper ARIA attributes', async () => {
      const { node } = await render(
        <ToggleEditor
          aria-label="Toggle setting"
          value={true}
          onChange={() => undefined}
        />,
      )

      expect(node).toHaveAttribute('aria-label', 'Toggle setting')
      expect(node).toHaveAttribute('aria-pressed', 'true')
    })

    test('supports field prop', async () => {
      const { node } = await render(
        <ToggleEditor
          field="myToggle"
          value={false}
          onChange={() => undefined}
        />,
      )

      expect(node).toHaveAttribute('data-field', 'myToggle')
    })
  })

  describe('content handling', () => {
    test('renders default On/Off text when none provided', async () => {
      const { node } = await render(<ToggleEditor onChange={() => undefined} />)

      // Should render default "Off" text when no custom content is provided
      expect(node.textContent?.trim()).toBe('Off')
    })

    test('renders children when on/off are undefined', async () => {
      const { node: offNode } = await render(
        <ToggleEditor value={false} onChange={() => undefined}>
          Custom Content
        </ToggleEditor>,
      )
      expect(offNode.textContent?.trim()).toBe('Custom Content')

      const { node: onNode } = await render(
        <ToggleEditor value={true} onChange={() => undefined}>
          Custom Content
        </ToggleEditor>,
      )
      expect(onNode.textContent?.trim()).toBe('Custom Content')
    })

    test('prioritizes on/off props over children', async () => {
      const { node: offNode } = await render(
        <ToggleEditor off="Off Text" value={false} onChange={() => undefined}>
          Children Content
        </ToggleEditor>,
      )
      expect(offNode.textContent?.trim()).toBe('Off Text')

      const { node: onNode } = await render(
        <ToggleEditor on="On Text" value={true} onChange={() => undefined}>
          Children Content
        </ToggleEditor>,
      )
      expect(onNode.textContent?.trim()).toBe('On Text')
    })

    test('falls back to default when on/off and children are undefined', async () => {
      const { node: offNode } = await render(
        <ToggleEditor value={false} onChange={() => undefined} />,
      )
      expect(offNode.textContent?.trim()).toBe('Off')

      const { node: onNode } = await render(
        <ToggleEditor value={true} onChange={() => undefined} />,
      )
      expect(onNode.textContent?.trim()).toBe('On')
    })

    test('handles React element icons', async () => {
      const CustomIcon = <svg data-testid="react-element-icon" />
      const { node } = await render(<ToggleEditor on={CustomIcon} value={true} onChange={() => undefined} />)

      const icon = node.querySelector('[data-testid="react-element-icon"]')
      expect(icon).toBeTruthy()
    })

    test('handles React element children', async () => {
      const CustomContent = <span data-testid="custom-children">Custom</span>
      const { node } = await render(
        <ToggleEditor value={false} onChange={() => undefined}>
          {CustomContent}
        </ToggleEditor>,
      )

      const content = node.querySelector('[data-testid="custom-children"]')
      expect(content).toBeTruthy()
      expect(content?.textContent).toBe('Custom')
    })

  })
})
