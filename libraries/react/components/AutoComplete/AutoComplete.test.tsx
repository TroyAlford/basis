import { describe, expect, mock, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { Simulate } from '../../testing/Simulate'
import { waitFor } from '../../testing/waitFor'
import { Keyboard } from '../../types/Keyboard'
import { styles } from '../../utilities/style'
import { AutoComplete } from './AutoComplete'

describe('AutoComplete', () => {
  describe('search counter behavior', () => {
    test('calls onSearch with correct query', async () => {
      const onSearch = mock(() => Promise.resolve(['result']))
      const onOpen = mock()

      const { node } = await render(
        <AutoComplete
          getOptionLabel={option => String(option)}
          getOptionValue={option => String(option)}
          onOpen={onOpen}
          onSearch={onSearch}
        />,
      )

      const input = node.querySelector('input') as HTMLInputElement
      await Simulate.change(input, 'test')

      // Wait for debounce and search
      await waitFor(() => onSearch.mock.calls.length > 0, { timeout: 500 })

      expect(onSearch).toHaveBeenCalledWith('test')
    })

    test('handles search errors gracefully', async () => {
      const onSearch = mock(() => Promise.reject(new Error('Search failed')))
      const onOpen = mock()

      const { node } = await render(
        <AutoComplete
          getOptionLabel={option => String(option)}
          getOptionValue={option => String(option)}
          onOpen={onOpen}
          onSearch={onSearch}
        />,
      )

      const input = node.querySelector('input') as HTMLInputElement
      await Simulate.change(input, 'test')

      // Wait for search to be called
      await waitFor(() => onSearch.mock.calls.length > 0, { timeout: 500 })

      // Component should handle the error without crashing
      expect(onSearch).toHaveBeenCalledWith('test')
    })

    test('debounces rapid input changes', async () => {
      const onSearch = mock(() => Promise.resolve(['result']))
      const onOpen = mock()

      const { node } = await render(
        <AutoComplete
          getOptionLabel={option => String(option)}
          getOptionValue={option => String(option)}
          onOpen={onOpen}
          onSearch={onSearch}
        />,
      )

      const input = node.querySelector('input') as HTMLInputElement

      // Rapidly type multiple characters using Simulate.change
      await Simulate.change(input, 't')
      await Simulate.change(input, 'te')
      await Simulate.change(input, 'tes')
      await Simulate.change(input, 'test')

      // Wait for debounce (250ms)
      await new Promise(resolve => setTimeout(resolve, 300))

      // Should only call onSearch once after debounce with final value
      expect(onSearch).toHaveBeenCalledTimes(1)
      expect(onSearch).toHaveBeenCalledWith('test')
    })

    test('respects minimumQueryLength', async () => {
      const onSearch = mock(() => Promise.resolve(['result']))
      const onOpen = mock()

      const { node } = await render(
        <AutoComplete
          getOptionLabel={option => String(option)}
          getOptionValue={option => String(option)}
          minimumQueryLength={3}
          onOpen={onOpen}
          onSearch={onSearch}
        />,
      )

      const input = node.querySelector('input') as HTMLInputElement

      // Type less than minimum
      await Simulate.change(input, 'te')

      // Wait a bit to ensure no search is triggered
      await new Promise(resolve => setTimeout(resolve, 300))

      // Should not call onSearch
      expect(onSearch).not.toHaveBeenCalled()

      // Type enough characters
      await Simulate.change(input, 'test')

      // Wait for debounce
      await waitFor(() => onSearch.mock.calls.length > 0, { timeout: 500 })

      // Now should call onSearch
      expect(onSearch).toHaveBeenCalledTimes(1)
      expect(onSearch).toHaveBeenCalledWith('test')
    })
  })

  describe('popup content state', () => {
    test('emits the shared error status and styles it by the same value', async () => {
      const onSearch = mock(() => Promise.reject(new Error('Search failed')))
      const { node } = await render(
        <AutoComplete
          open
          getOptionLabel={option => String(option)}
          getOptionValue={option => String(option)}
          onSearch={onSearch}
        />,
      )

      const input = node.querySelector('input') as HTMLInputElement
      await Simulate.change(input, 'test')

      const content = await waitFor(
        () => node.querySelector(`[data-state="${AutoComplete.Status.Error}"]`),
        { timeout: 1_000 },
      )

      expect(content).not.toBeNull()
      expect(styles()).toContain(`[data-state="${AutoComplete.Status.Error}"]`)
    })

    test('emits the shared not-found status and styles it by the same value', async () => {
      const onSearch = mock(() => Promise.resolve([]))
      const { node } = await render(
        <AutoComplete
          open
          getOptionLabel={option => String(option)}
          getOptionValue={option => String(option)}
          onSearch={onSearch}
        />,
      )

      const input = node.querySelector('input') as HTMLInputElement
      await Simulate.change(input, 'test')

      const content = await waitFor(
        () => node.querySelector(`[data-state="${AutoComplete.Status.NotFound}"]`),
        { timeout: 1_000 },
      )

      expect(content).not.toBeNull()
      expect(styles()).toContain(`[data-state="${AutoComplete.Status.NotFound}"]`)
    })

    test('styles every declared status value', () => {
      for (const status of Object.values(AutoComplete.Status)) {
        expect(styles()).toContain(`[data-state="${status}"]`)
      }
    })
  })

  describe('combobox semantics', () => {
    /**
     * Render an uncontrolled AutoComplete and drive it open through a search.
     * @param results - The search results to return.
     * @param getOptionDisabled - Optional per-option disabled predicate.
     * @returns The rendered node, the focused input, and the select spy.
     */
    const renderOpen = async (
      results: string[],
      getOptionDisabled?: (option: string) => boolean,
    ) => {
      const onSearch = mock(() => Promise.resolve(results))
      const onSelect = mock()
      const view = await render(
        <AutoComplete
          getOptionDisabled={getOptionDisabled}
          getOptionLabel={option => String(option)}
          getOptionValue={option => String(option)}
          onSearch={onSearch}
          onSelect={onSelect}
        />,
      )
      // The render helper mounts detached; attach so focus/activeElement behave.
      document.body.appendChild(view.root)

      const input = view.node.querySelector('input') as HTMLInputElement
      await Simulate.change(input, 'a')
      await waitFor(
        () => view.node.querySelectorAll('[role="option"]').length === results.length,
        { timeout: 1_000 },
      )
      input.focus()

      return { ...view, input, onSearch, onSelect }
    }

    /**
     * The rendered option elements.
     * @param node - The component root node.
     * @returns The option elements.
     */
    const optionElements = (node: HTMLElement): HTMLElement[] => (
      Array.from(node.querySelectorAll<HTMLElement>('[role="option"]'))
    )

    test('exposes a combobox input that controls a listbox of options', async () => {
      const { input, node } = await renderOpen(['alpha', 'beta'])

      expect(input.getAttribute('role')).toBe('combobox')
      expect(input.getAttribute('aria-expanded')).toBe('true')
      expect(input.getAttribute('aria-autocomplete')).toBe('list')

      const listbox = node.querySelector('[role="listbox"]')
      expect(listbox).not.toBeNull()
      expect(input.getAttribute('aria-controls')).toBe(listbox?.id)

      const options = optionElements(node)
      expect(options).toHaveLength(2)
      for (const option of options) {
        expect(option.getAttribute('aria-selected')).not.toBeNull()
        expect(option.getAttribute('tabindex')).toBe('-1')
      }
    })

    test('reports a collapsed combobox while closed', async () => {
      const onSearch = mock(() => Promise.resolve([]))
      const { node } = await render(
        <AutoComplete
          getOptionLabel={option => String(option)}
          getOptionValue={option => String(option)}
          onSearch={onSearch}
        />,
      )

      const input = node.querySelector('input') as HTMLInputElement
      expect(input.getAttribute('role')).toBe('combobox')
      expect(input.getAttribute('aria-expanded')).toBe('false')
      expect(node.querySelector('[role="listbox"]')).toBeNull()
    })

    test('moves aria-activedescendant while DOM focus stays on the combobox', async () => {
      const { input, node } = await renderOpen(['alpha', 'beta'])
      const options = optionElements(node)

      expect(document.activeElement).toBe(input)
      expect(input.getAttribute('aria-activedescendant')).toBeNull()

      await Simulate.pressKey(input, Keyboard.ArrowDown)
      await waitFor(() => input.getAttribute('aria-activedescendant') === options[0]?.id)
      expect(document.activeElement).toBe(input)
      expect(options[0]?.getAttribute('aria-selected')).toBe('true')

      await Simulate.pressKey(input, Keyboard.ArrowDown)
      await waitFor(() => input.getAttribute('aria-activedescendant') === options[1]?.id)
      expect(document.activeElement).toBe(input)

      await Simulate.pressKey(input, Keyboard.ArrowUp)
      await waitFor(() => input.getAttribute('aria-activedescendant') === options[0]?.id)
      expect(document.activeElement).toBe(input)
    })

    test('activates the active option with Enter and keeps focus on the combobox', async () => {
      const { input, node, onSelect } = await renderOpen(['alpha', 'beta'])

      await Simulate.pressKey(input, Keyboard.ArrowDown)
      await Simulate.pressKey(input, Keyboard.Enter)
      await waitFor(() => onSelect.mock.calls.length > 0)

      expect(onSelect).toHaveBeenCalledWith('alpha', 'alpha')
      expect(document.activeElement).toBe(input)
      expect(node.querySelector('[role="listbox"]')).toBeNull()
    })

    test('closes on Escape and keeps focus on the combobox', async () => {
      const { input, node } = await renderOpen(['alpha'])

      await Simulate.pressKey(input, Keyboard.Escape)
      await waitFor(() => node.querySelector('[role="listbox"]') === null)

      expect(document.activeElement).toBe(input)
    })

    test('does not activate a disabled option with Enter', async () => {
      const { input, node, onSelect } = await renderOpen(
        ['alpha', 'beta'],
        option => option === 'alpha',
      )
      const options = optionElements(node)

      // A disabled option can become active, but Enter must not select it.
      await Simulate.pressKey(input, Keyboard.ArrowDown)
      await waitFor(() => input.getAttribute('aria-activedescendant') === options[0]?.id)
      expect(options[0]?.getAttribute('aria-disabled')).toBe('true')

      await Simulate.pressKey(input, Keyboard.Enter)
      expect(onSelect).not.toHaveBeenCalled()
      expect(node.querySelector('[role="listbox"]')).not.toBeNull()

      // Moving on to the enabled option allows Enter to activate it.
      await Simulate.pressKey(input, Keyboard.ArrowDown)
      await waitFor(() => input.getAttribute('aria-activedescendant') === options[1]?.id)
      await Simulate.pressKey(input, Keyboard.Enter)
      await waitFor(() => onSelect.mock.calls.length > 0)
      expect(onSelect).toHaveBeenCalledWith('beta', 'beta')
    })

    test('gives each instance distinct, non-sequential listbox ids', async () => {
      const first = await renderOpen(['alpha'])
      const second = await renderOpen(['beta'])

      const firstId = first.node.querySelector('[role="listbox"]')?.id ?? ''
      const secondId = second.node.querySelector('[role="listbox"]')?.id ?? ''

      expect(firstId).not.toBe('')
      expect(firstId).not.toBe(secondId)
      expect(firstId).not.toMatch(/^basis:auto-complete:\d+:listbox$/)
    })
  })
})
