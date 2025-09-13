import { describe, expect, test } from 'bun:test'
import type { ComponentClass } from 'react'
import React from 'react'
import { kebabCase } from '@basis/utilities'
import { render } from '../../react/testing/render'
import * as icons from './icons'
import { SortBy, SortDirection } from './Sort'

describe('icons/Icons', () => {
  describe('Icon', () => {
    test('renders all other icons by name', async () => {
      await Promise.all(
        Object.entries<ComponentClass>(icons as unknown as Record<string, ComponentClass>)
          .filter(([name, Icon]) => typeof Icon === 'function' && name !== 'IconBase')
          .map(async ([name, IconFn]) => {
            const direct = await render(<IconFn />)
            const cased = await render(<icons.Icon named={kebabCase(name)} />)
            const generic = await render(<icons.Icon named={name} />)

            // Check that the rendered HTML is the same
            expect(cased.node.innerHTML).toEqual(generic.node.innerHTML)
            expect(direct.node.innerHTML).toEqual(generic.node.innerHTML)

            // Verify that the components render something (not empty)
            expect(direct.node.innerHTML).toBeTruthy()
            expect(generic.node.innerHTML).toBeTruthy()
            expect(cased.node.innerHTML).toBeTruthy()
          }),
      )
    })

    test('gracefully renders Blank for unknown names', async () => {
      const wrapper = await render(<icons.Icon named="unknown" />)
      // Check that it renders something (the Blank component)
      expect(wrapper.node.innerHTML).toBeTruthy()
      // Verify it's an SVG element (the wrapper node itself is the SVG)
      expect(wrapper.node.tagName).toBe('svg')
    })

    test('renderContent returns null', () => {
      const icon = new icons.Icon(null)
      expect(icon.renderContent()).toBe(null)
    })
  })

  describe('Sort', () => {
    test('renders variants', async () => {
      await Promise.all([
        [{ direction: SortDirection.Asc, sortBy: SortBy.Name }, icons.SortByNameAsc],
        [{ direction: SortDirection.Asc, sortBy: SortBy.Size }, icons.SortBySizeAsc],
        [{ direction: SortDirection.Asc, sortBy: SortBy.Value }, icons.SortByValueAsc],
        [{ direction: SortDirection.Desc, sortBy: SortBy.Name }, icons.SortByNameDesc],
        [{ direction: SortDirection.Desc, sortBy: SortBy.Size }, icons.SortBySizeDesc],
        [{ direction: SortDirection.Desc, sortBy: SortBy.Value }, icons.SortByValueDesc],
      ].map(async ([props]) => {
        const wrapper = await render(<icons.Sort {...props} />)
        expect(wrapper.node.innerHTML).toBeTruthy()
        // Verify it's an SVG element (the wrapper node itself is the SVG)
        expect(wrapper.node.tagName).toBe('svg')
      }))

      // @ts-expect-error - invalid props
      const { node } = await render(<icons.Sort direction="foo" sortBy="bar" />)
      expect(node).toBeNull()
    })

    test('renderContent returns null', () => {
      const icon = new icons.Sort(null)
      expect(icon.renderContent()).toBe(null)
    })
  })
})
