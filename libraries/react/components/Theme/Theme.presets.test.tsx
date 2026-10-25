import { describe, expect, test } from 'bun:test'
import { Color } from '../../../utilities/functions/Color'
import * as Basis from '../../index'
import { DARK_THEME, DEFAULT_THEME, LIGHT_THEME, themeStyles } from './Theme'

/**
 * The WCAG relative luminance of a colour.
 * @param color - The colour to measure.
 * @returns The relative luminance.
 */
function luminance(color: string): number {
  const { b, g, r } = Color.from(color).toRGB()
  const linear = (channel: number): number => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return (0.2126 * linear(r)) + (0.7152 * linear(g)) + (0.0722 * linear(b))
}

/**
 * The WCAG contrast ratio between two colours.
 * @param one - The first colour.
 * @param two - The second colour.
 * @returns The contrast ratio.
 */
function contrast(one: string, two: string): number {
  const [light, dark] = [luminance(one), luminance(two)].sort((a, b) => b - a)
  return (light + 0.05) / (dark + 0.05)
}

/**
 * Read one custom property from generated CSS.
 * @param css - The generated stylesheet.
 * @param property - The custom property to read.
 * @returns The declared value, or undefined.
 */
function declared(css: string, property: string): string | undefined {
  return new RegExp(`${property}:\\s*([^;]+);`).exec(css)?.[1].trim()
}

describe('Theme presets', () => {
  test('keeps DEFAULT_THEME and LIGHT_THEME as the unchanged light palette', () => {
    expect(DEFAULT_THEME.color).toMatchObject({
      background: '#ffffff',
      danger: '#C00000',
      disabled: '#e5e5e5',
      disabledText: '#a3a3a3',
      foreground: '#171717',
      overlayDark: '#00000080',
      overlayLight: '#ffffff80',
      primary: '#0070f3',
      success: '#008000',
    })
    expect(LIGHT_THEME.color).toEqual(DEFAULT_THEME.color)
  })

  test('publishes the official presets from the public basis/react surface', () => {
    expect(Basis.LIGHT_THEME).toEqual(LIGHT_THEME)
    expect(Basis.DARK_THEME).toEqual(DARK_THEME)
  })

  test('makes the dark background substantially darker than MTG #30404d', () => {
    expect(luminance(DARK_THEME.color.background)).toBeLessThan(luminance('#30404d') / 4)
  })

  test('separates the dark background, surfaces, borders, and interactive roles', () => {
    const roles = [
      DARK_THEME.color.background,
      DARK_THEME.color.surface,
      DARK_THEME.color.surfaceAlt,
      DARK_THEME.color.surfaceElevated,
      DARK_THEME.color.border,
      DARK_THEME.color.borderSubtle,
      DARK_THEME.color.hover,
      DARK_THEME.color.selection,
    ]

    expect(new Set(roles).size).toBe(roles.length)
    expect(luminance(DARK_THEME.color.background)).toBeLessThan(luminance(DARK_THEME.color.surface))
    expect(luminance(DARK_THEME.color.surface)).toBeLessThan(luminance(DARK_THEME.color.surfaceAlt))
    expect(luminance(DARK_THEME.color.surfaceAlt)).toBeLessThan(luminance(DARK_THEME.color.surfaceElevated))
    expect(luminance(DARK_THEME.color.surfaceElevated)).toBeLessThan(luminance(DARK_THEME.color.border))
  })

  test('keeps text readable on every dark interactive surface', () => {
    const { color } = DARK_THEME
    const states = [color.surface, color.surfaceAlt, color.surfaceElevated, color.hover, color.selection]

    for (const state of states) {
      expect(contrast(color.foreground, state)).toBeGreaterThanOrEqual(4.5)
    }

    expect(contrast(color.foreground, color.background)).toBeGreaterThanOrEqual(7)
    expect(contrast(color.foregroundMuted, color.background)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(color.foregroundMuted, color.surface)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(color.disabledText, color.disabled)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(color.focus, color.surface)).toBeGreaterThanOrEqual(3)
  })

  test('keeps the dark primary, danger, and success accents readable in both directions', () => {
    const { color } = DARK_THEME

    for (const accent of [color.primary, color.danger, color.success]) {
      expect(contrast(accent, color.background)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(accent, Color.from(accent).contrast().toString())).toBeGreaterThanOrEqual(4.5)
    }
  })

  test('generates the semantic dark tokens under the named dark theme scope', () => {
    const css = themeStyles({ name: 'dark', ...DARK_THEME })

    expect(css).toMatch(/^:root \[data-theme="dark"\] {/)
    for (const token of [
      'background',
      'border',
      'border-subtle',
      'danger',
      'disabled',
      'disabled-text',
      'focus',
      'foreground',
      'foreground-muted',
      'hover',
      'primary',
      'selection',
      'success',
      'surface',
      'surface-alt',
      'surface-elevated',
    ]) {
      expect(css).toContain(`--basis-color-${token}:`)
    }
    expect(declared(css, '--basis-color-background')).toBe('#080a0dff')
    expect(declared(css, '--basis-color-surface')).toBe('#11151aff')
    expect(declared(css, '--basis-color-surface-elevated')).toBe('#1c232bff')
  })

  test('keeps the existing light token values under a named light theme', () => {
    const css = themeStyles({ name: 'light', ...LIGHT_THEME })

    expect(css).toMatch(/^:root \[data-theme="light"\] {/)
    expect(declared(css, '--basis-color-background')).toBe('#ffffffff')
    expect(declared(css, '--basis-color-foreground')).toBe('#171717ff')
    expect(declared(css, '--basis-color-primary')).toBe('#0070f3ff')
    expect(declared(css, '--basis-color-danger')).toBe('#c00000ff')
    expect(declared(css, '--basis-color-success')).toBe('#008000ff')
    expect(declared(css, '--basis-color-disabled')).toBe('#e5e5e5ff')
    expect(declared(css, '--basis-color-disabled-text')).toBe('#a3a3a3ff')
  })
})
