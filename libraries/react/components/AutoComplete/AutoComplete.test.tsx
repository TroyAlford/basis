import { describe, expect, mock, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { Simulate } from '../../testing/Simulate'
import { waitFor } from '../../testing/waitFor'
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
})
