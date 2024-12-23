import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import { render } from '../../testing/render'
import { Theme } from './Theme'

describe('Theme', () => {
  describe('rendering', () => {
    test('renders with minimal props', () => {
      const { node } = render(<Theme name="test" />)
      expect(node.tagName).toBe('STYLE')
      expect(node.textContent).toContain('[theme="test"]')
    })

    test('renders with all props', () => {
      const { node } = render(
        <Theme
          name="test"
          color={{
            background: 'rgb(255, 255, 255)',
            disabled: '#cccccc',
            disabledText: '#666666',
            foreground: 'hsl(0, 0%, 0%)',
            overlayDark: 'rgba(0, 0, 0, 0.5)',
            overlayLight: 'rgba(255, 255, 255, 0.5)',
            primary: '#ff0000',
          }}
          fontSize={{
            lg: 112.5,
            md: 100,
            sm: 87.5,
            xl: 125,
            xs: 75,
            xxl: 150,
            xxs: 50,
          }}
          radius={{
            lg: 16,
            md: 8,
            round: 9999,
            sm: 4,
          }}
          shadow={{
            lg: '0 4px 8px rgba(0, 0, 0, 0.1)',
            md: '0 2px 4px rgba(0, 0, 0, 0.1)',
            sm: '0 1px 2px rgba(0, 0, 0, 0.1)',
          }}
          transition={{
            fast: '100ms ease',
            medium: '200ms ease',
            slow: '300ms ease',
          }}
          unit={{
            lg: 32,
            md: 16,
            sm: 8,
            xl: 64,
            xs: 4,
            xxl: 128,
            xxs: 2,
          }}
        />,
      )

      const css = node.textContent || ''

      // Test color processing
      expect(css).toContain('--basis-color-primary: #ff0000ff')
      expect(css).toContain('--basis-color-background: #ffffffff')
      expect(css).toContain('--basis-color-foreground: #000000ff')
      expect(css).toContain('--basis-color-disabled: #ccccccff')
      expect(css).toContain('--basis-color-disabled-text: #666666ff')
      expect(css).toContain('--basis-color-overlay-light: #ffffff80')
      expect(css).toContain('--basis-color-overlay-dark: #00000080')

      // Test font sizes
      expect(css).toContain('--basis-font-size-xxs: 50%')
      expect(css).toContain('--basis-font-size-xs: 75%')
      expect(css).toContain('--basis-font-size-sm: 87.5%')
      expect(css).toContain('--basis-font-size-md: 100%')
      expect(css).toContain('--basis-font-size-lg: 112.5%')
      expect(css).toContain('--basis-font-size-xl: 125%')
      expect(css).toContain('--basis-font-size-xxl: 150%')

      // Test radii
      expect(css).toContain('--basis-radius-sm: 4px')
      expect(css).toContain('--basis-radius-md: 8px')
      expect(css).toContain('--basis-radius-lg: 16px')
      expect(css).toContain('--basis-radius-round: 9999px')

      // Test shadows
      expect(css).toContain('--basis-shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.1)')
      expect(css).toContain('--basis-shadow-md: 0 2px 4px rgba(0, 0, 0, 0.1)')
      expect(css).toContain('--basis-shadow-lg: 0 4px 8px rgba(0, 0, 0, 0.1)')

      // Test transitions
      expect(css).toContain('--basis-transition-fast: 100ms ease')
      expect(css).toContain('--basis-transition-medium: 200ms ease')
      expect(css).toContain('--basis-transition-slow: 300ms ease')

      // Test units
      expect(css).toContain('--basis-unit-xxs: 2px')
      expect(css).toContain('--basis-unit-xs: 4px')
      expect(css).toContain('--basis-unit-sm: 8px')
      expect(css).toContain('--basis-unit-md: 16px')
      expect(css).toContain('--basis-unit-lg: 32px')
      expect(css).toContain('--basis-unit-xl: 64px')
      expect(css).toContain('--basis-unit-xxl: 128px')
    })
  })

  describe('color processing', () => {
    test('processes hex colors', () => {
      const { node } = render(
        <Theme
          color={{ primary: '#ff0000' }}
          name="test"
        />,
      )
      expect(node.textContent).toContain('--basis-color-primary: #ff0000ff')
    })

    test('processes rgb colors', () => {
      const { node } = render(
        <Theme
          color={{ primary: 'rgb(255, 0, 0)' }}
          name="test"
        />,
      )
      expect(node.textContent).toContain('--basis-color-primary: #ff0000ff')
    })

    test('processes rgba colors', () => {
      const { node } = render(
        <Theme
          color={{ primary: 'rgba(255, 0, 0, 0.5)' }}
          name="test"
        />,
      )
      expect(node.textContent).toContain('--basis-color-primary: #ff000080')
    })

    test('processes hsl colors', () => {
      const { node } = render(
        <Theme
          color={{ primary: 'hsl(0, 100%, 50%)' }}
          name="test"
        />,
      )
      expect(node.textContent).toContain('--basis-color-primary: #ff0000ff')
    })

    test('processes hsla colors', () => {
      const { node } = render(
        <Theme
          color={{ primary: 'hsla(0, 100%, 50%, 0.5)' }}
          name="test"
        />,
      )
      expect(node.textContent).toContain('--basis-color-primary: #ff000080')
    })
  })

  describe('value processing', () => {
    test('adds px to numeric values', () => {
      const { node } = render(
        <Theme
          name="test"
          radius={{ md: 8 }}
          unit={{ md: 16 }}
        />,
      )
      expect(node.textContent).toContain('--basis-unit-md: 16px')
      expect(node.textContent).toContain('--basis-radius-md: 8px')
    })

    test('adds % to font sizes', () => {
      const { node } = render(
        <Theme
          fontSize={{ md: 100 }}
          name="test"
        />,
      )
      expect(node.textContent).toContain('--basis-font-size-md: 100%')
    })

    test('preserves string values for shadows and transitions', () => {
      const { node } = render(
        <Theme
          name="test"
          shadow={{ md: '0 2px 4px rgba(0, 0, 0, 0.1)' }}
          transition={{ fast: '100ms ease' }}
        />,
      )
      expect(node.textContent).toContain('--basis-shadow-md: 0 2px 4px rgba(0, 0, 0, 0.1)')
      expect(node.textContent).toContain('--basis-transition-fast: 100ms ease')
    })
  })

  describe('theme namespacing', () => {
    test('namespaces variables under theme attribute', () => {
      const { node } = render(
        <Theme
          color={{ primary: '#ff0000' }}
          name="light"
        />,
      )
      expect(node.textContent).toMatch(/^:root \[theme="light"\] {/)
    })

    test('handles special characters in theme name', () => {
      const { node } = render(
        <Theme
          color={{ primary: '#ff0000' }}
          name="theme:light@2x"
        />,
      )
      expect(node.textContent).toMatch(/^:root \[theme="theme:light@2x"\] {/)
    })
  })
})
