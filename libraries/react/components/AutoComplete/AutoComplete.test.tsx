import { describe, expect, mock, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { Simulate } from '../../testing/Simulate'
import { waitFor } from '../../testing/waitFor'
import { styles } from '../../utilities/style'
import { AutoComplete } from './AutoComplete'
import { AutoCompleteStatus } from './AutoCompleteStatus'

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
        () => node.querySelector(`[data-state="${AutoCompleteStatus.Error}"]`),
        { timeout: 1_000 },
      )

      expect(content).not.toBeNull()
      expect(styles()).toContain(`[data-state="${AutoCompleteStatus.Error}"]`)
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
        () => node.querySelector(`[data-state="${AutoCompleteStatus.NotFound}"]`),
        { timeout: 1_000 },
      )

      expect(content).not.toBeNull()
      expect(styles()).toContain(`[data-state="${AutoCompleteStatus.NotFound}"]`)
    })

    test('styles every declared status value', () => {
      for (const status of Object.values(AutoCompleteStatus)) {
        expect(styles()).toContain(`[data-state="${status}"]`)
      }
    })
  })
})
