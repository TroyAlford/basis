import { describe, expect, mock, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { Simulate } from '../../testing/Simulate'
import { waitFor } from '../../testing/waitFor'
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
    test('exposes a combobox input that controls a listbox of options', async () => {
      const onSearch = mock(() => Promise.resolve(['alpha', 'beta']))
      const { node } = await render(
        <AutoComplete
          open
          getOptionLabel={option => String(option)}
          getOptionValue={option => String(option)}
          onSearch={onSearch}
        />,
      )

      const input = node.querySelector('input') as HTMLInputElement
      await Simulate.change(input, 'a')
      await waitFor(() => node.querySelectorAll('[role="option"]').length === 2, { timeout: 1_000 })

      expect(input.getAttribute('role')).toBe('combobox')
      expect(input.getAttribute('aria-expanded')).toBe('true')
      expect(input.getAttribute('aria-autocomplete')).toBe('list')

      const listbox = node.querySelector('[role="listbox"]')
      expect(listbox).not.toBeNull()
      expect(input.getAttribute('aria-controls')).toBe(listbox?.id)

      const options = node.querySelectorAll('[role="option"]')
      expect(options).toHaveLength(2)
      for (const option of options) {
        expect(option.getAttribute('aria-selected')).not.toBeNull()
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

    test('tracks the active option with aria-activedescendant', async () => {
      const onSearch = mock(() => Promise.resolve(['alpha', 'beta']))
      const { node } = await render(
        <AutoComplete
          open
          getOptionLabel={option => String(option)}
          getOptionValue={option => String(option)}
          onSearch={onSearch}
        />,
      )

      const input = node.querySelector('input') as HTMLInputElement
      await Simulate.change(input, 'a')
      await waitFor(() => node.querySelectorAll('[role="option"]').length === 2, { timeout: 1_000 })

      expect(input.getAttribute('aria-activedescendant')).toBeNull()

      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowDown' }))
      await waitFor(
        () => input.getAttribute('aria-activedescendant') !== null,
        { timeout: 1_000 },
      )

      const [first] = Array.from(node.querySelectorAll('[role="option"]'))
      expect(input.getAttribute('aria-activedescendant')).toBe(first?.id)
      expect(first?.getAttribute('aria-selected')).toBe('true')
    })
  })
})
