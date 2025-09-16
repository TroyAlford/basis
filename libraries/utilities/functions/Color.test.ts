import { describe, expect, test } from 'bun:test'
import { Color } from './Color'

describe('Color', () => {
  describe('RGB', () => {
    test('creates from RGB values', () => {
      const color = Color.fromRGB(255, 0, 0)
      expect(color.toRGB()).toEqual({ a: 1, b: 0, g: 0, r: 255 })
    })

    test('creates from RGB object', () => {
      const color = Color.fromRGB({ b: 0, g: 0, r: 255 })
      expect(color.toRGB()).toEqual({ a: 1, b: 0, g: 0, r: 255 })
    })

    test('creates from RGB string', () => {
      const color = Color.fromRGB('rgb(255, 0, 0)')
      expect(color.toRGB()).toEqual({ a: 1, b: 0, g: 0, r: 255 })
    })

    test('creates from RGBA string', () => {
      const color = Color.fromRGB('rgba(255, 0, 0, 0.5)')
      expect(color.toRGB()).toEqual({ a: 0.5, b: 0, g: 0, r: 255 })
    })

    test('handles RGB string with spaces', () => {
      const color = Color.fromRGB('  rgb(  255  ,  0  ,  0  )  ')
      expect(color.toRGB()).toEqual({ a: 1, b: 0, g: 0, r: 255 })
    })

    test('throws on invalid RGB string', () => {
      expect(() => Color.fromRGB('not a color')).toThrow('Invalid RGB string')
    })
  })

  describe('HSV', () => {
    test('creates from HSV values', () => {
      const color = Color.fromHSV(0, 100, 100)
      expect(color.toRGB()).toEqual({ a: 1, b: 0, g: 0, r: 255 })
    })

    test('creates from HSV object', () => {
      const color = Color.fromHSV({ h: 0, s: 100, v: 100 })
      expect(color.toRGB()).toEqual({ a: 1, b: 0, g: 0, r: 255 })
    })

    test('creates from HSV string', () => {
      const color = Color.fromHSV('hsv(0, 100%, 100%)')
      expect(color.toRGB()).toEqual({ a: 1, b: 0, g: 0, r: 255 })
    })

    test('creates from HSVA string', () => {
      const color = Color.fromHSV('hsva(0, 100%, 100%, 0.5)')
      expect(color.toRGB()).toEqual({ a: 0.5, b: 0, g: 0, r: 255 })
    })

    test('handles HSV string with spaces', () => {
      const color = Color.fromHSV('  hsv(  0  ,  100%  ,  100%  )  ')
      expect(color.toRGB()).toEqual({ a: 1, b: 0, g: 0, r: 255 })
    })

    test('throws on invalid HSV string', () => {
      expect(() => Color.fromHSV('not a color')).toThrow('Invalid HSV string')
    })

    // Test all HSV hue angles
    test.each([
      [0, [255, 0, 0]],    // Red
      [60, [255, 255, 0]], // Yellow
      [120, [0, 255, 0]],  // Green
      [180, [0, 255, 255]], // Cyan
      [240, [0, 0, 255]],  // Blue
      [300, [255, 0, 255]], // Magenta
      [360, [255, 0, 0]],  // Red again
    ])('converts hue %i° correctly', (hue, [r, g, b]) => {
      const color = Color.fromHSV(hue, 100, 100)
      expect(color.toRGB()).toEqual({ a: 1, b, g, r })
    })
  })

  describe('HSL', () => {
    test('creates from HSL values', () => {
      const color = Color.fromHSL(0, 100, 50)
      expect(color.toRGB()).toEqual({ a: 1, b: 0, g: 0, r: 255 })
    })

    test('creates from HSL object', () => {
      const color = Color.fromHSL({ h: 0, l: 50, s: 100 })
      expect(color.toRGB()).toEqual({ a: 1, b: 0, g: 0, r: 255 })
    })

    test('creates from HSL string', () => {
      const color = Color.fromHSL('hsl(0, 100%, 50%)')
      expect(color.toRGB()).toEqual({ a: 1, b: 0, g: 0, r: 255 })
    })

    test('creates from HSLA string', () => {
      const color = Color.fromHSL('hsla(0, 100%, 50%, 0.5)')
      expect(color.toRGB()).toEqual({ a: 0.5, b: 0, g: 0, r: 255 })
    })

    test('handles HSL string with spaces', () => {
      const color = Color.fromHSL('  hsl(  0  ,  100%  ,  50%  )  ')
      expect(color.toRGB()).toEqual({ a: 1, b: 0, g: 0, r: 255 })
    })

    test('throws on invalid HSL string', () => {
      expect(() => Color.fromHSL('not a color')).toThrow('Invalid HSL string')
    })

    // Test all HSL hue angles
    test.each([
      [0, [255, 0, 0]],    // Red
      [60, [255, 255, 0]], // Yellow
      [120, [0, 255, 0]],  // Green
      [180, [0, 255, 255]], // Cyan
      [240, [0, 0, 255]],  // Blue
      [300, [255, 0, 255]], // Magenta
      [360, [255, 0, 0]],  // Red again
    ])('converts hue %i° correctly', (hue, [r, g, b]) => {
      const color = Color.fromHSL(hue, 100, 50)
      expect(color.toRGB()).toEqual({ a: 1, b, g, r })
    })
  })

  describe('Hex', () => {
    test('creates from hex with #', () => {
      const color = Color.fromHex('#ff0000')
      expect(color.toRGB()).toEqual({ a: 1, b: 0, g: 0, r: 255 })
    })

    test('creates from hex without #', () => {
      const color = Color.fromHex('ff0000')
      expect(color.toRGB()).toEqual({ a: 1, b: 0, g: 0, r: 255 })
    })

    test('creates from hex with alpha', () => {
      const color = Color.fromHex('#ff000080')
      expect(color.toRGB()).toEqual({ a: 0.5, b: 0, g: 0, r: 255 })
    })

    test('handles uppercase hex', () => {
      const color = Color.fromHex('#FF0000')
      expect(color.toRGB()).toEqual({ a: 1, b: 0, g: 0, r: 255 })
    })

    test('throws on invalid hex', () => {
      expect(() => Color.fromHex('not a color')).toThrow('Invalid hex color')
    })
  })

  describe('String Parsing', () => {
    test('parses hex colors', () => {
      const color = Color.from('#ff0000')
      expect(color.toRGB()).toEqual({ a: 1, b: 0, g: 0, r: 255 })
    })

    test('parses RGB colors', () => {
      const color = Color.from('rgb(255, 0, 0)')
      expect(color.toRGB()).toEqual({ a: 1, b: 0, g: 0, r: 255 })
    })

    test('parses HSV colors', () => {
      const color = Color.from('hsv(0, 100%, 100%)')
      expect(color.toRGB()).toEqual({ a: 1, b: 0, g: 0, r: 255 })
    })

    test('parses HSL colors', () => {
      const color = Color.from('hsl(0, 100%, 50%)')
      expect(color.toRGB()).toEqual({ a: 1, b: 0, g: 0, r: 255 })
    })

    test('throws on invalid color string', () => {
      expect(() => Color.from('not a color')).toThrow('Invalid color format')
    })
  })

  describe('String Output', () => {
    const color = Color.fromRGB(255, 0, 0, 0.5)

    test('outputs hex string', () => {
      expect(color.toHex()).toBe('#ff000080')
    })

    test('outputs RGB string', () => {
      expect(color.toRGBString()).toBe('rgba(255, 0, 0, 0.5)')
    })

    test('outputs HSV string', () => {
      expect(color.toHSVString()).toBe('hsva(0, 100%, 100%, 0.5)')
    })

    test('outputs HSL string', () => {
      expect(color.toHSLString()).toBe('hsla(0, 100%, 50%, 0.5)')
    })

    test('uses toString() for hex output', () => {
      expect(color.toString()).toBe('#ff000080')
    })
  })

  describe('Validation', () => {
    test('validates RGB values', () => {
      expect(() => Color.fromRGB(-1, 0, 0)).toThrow('Invalid color values')
      expect(() => Color.fromRGB(256, 0, 0)).toThrow('Invalid color values')
      expect(() => Color.fromRGB(0, -1, 0)).toThrow('Invalid color values')
      expect(() => Color.fromRGB(0, 256, 0)).toThrow('Invalid color values')
      expect(() => Color.fromRGB(0, 0, -1)).toThrow('Invalid color values')
      expect(() => Color.fromRGB(0, 0, 256)).toThrow('Invalid color values')
      expect(() => Color.fromRGB(0, 0, 0, -0.1)).toThrow('Invalid color values')
      expect(() => Color.fromRGB(0, 0, 0, 1.1)).toThrow('Invalid color values')
    })
  })

  describe('Color Conversions', () => {
    const testColors = [
      { hsl: [0, 100, 50], hsv: [0, 100, 100], rgb: [255, 0, 0] },    // Red
      { hsl: [120, 100, 50], hsv: [120, 100, 100], rgb: [0, 255, 0] }, // Green
      { hsl: [240, 100, 50], hsv: [240, 100, 100], rgb: [0, 0, 255] }, // Blue
      { hsl: [0, 0, 0], hsv: [0, 0, 0], rgb: [0, 0, 0] },             // Black
      { hsl: [0, 0, 100], hsv: [0, 0, 100], rgb: [255, 255, 255] },   // White
      { hsl: [0, 0, 50], hsv: [0, 0, 50], rgb: [128, 128, 128] },     // Gray
    ]

    test.each(testColors)('converts between formats correctly', ({ hsl, hsv, rgb }) => {
      const [r, g, b] = rgb
      const [h1, s1, v] = hsv
      const [h2, s2, l] = hsl

      const color = Color.fromRGB(r, g, b)

      expect(color.toHSV()).toEqual({ a: 1, h: h1, s: s1, v })
      expect(color.toHSL()).toEqual({ a: 1, h: h2, l, s: s2 })
      expect(color.toRGB()).toEqual({ a: 1, b, g, r })
    })
  })

  describe('contrast()', () => {
    test('returns dark color for light colors', () => {
      const white = Color.fromHex('#ffffff')
      const contrast = white.contrast()
      expect(contrast.toRGB()).toEqual({ a: 1, b: 0, g: 0, r: 0 })
    })

    test('returns light color for dark colors', () => {
      const black = Color.fromHex('#000000')
      const contrast = black.contrast()
      expect(contrast.toRGB()).toEqual({ a: 1, b: 255, g: 255, r: 255 })
    })

    test('returns appropriate contrast for medium blue color', () => {
      const blue = Color.fromHex('#336699')
      const contrast = blue.contrast()
      // This should be dark enough to return light color
      expect(contrast.toRGB()).toEqual({ a: 1, b: 255, g: 255, r: 255 })
    })

    test('returns dark color for light blue', () => {
      const lightBlue = Color.fromHex('#87CEEB')
      const contrast = lightBlue.contrast()
      expect(contrast.toRGB()).toEqual({ a: 1, b: 0, g: 0, r: 0 })
    })

    test('returns light color for dark red', () => {
      const darkRed = Color.fromHex('#8B0000')
      const contrast = darkRed.contrast()
      expect(contrast.toRGB()).toEqual({ a: 1, b: 255, g: 255, r: 255 })
    })

    test('contrast method uses provided onDark/onLight colors', () => {
      const customOnDark = Color.fromHex('#ff0000') // Red
      const customOnLight = Color.fromHex('#00ff00') // Green

      const lightColor = Color.fromHex('#ffffff')
      const darkColor = Color.fromHex('#000000')

      expect(lightColor.contrast(customOnDark, customOnLight).toHex()).toBe(customOnLight.toHex())
      expect(darkColor.contrast(customOnDark, customOnLight).toHex()).toBe(customOnDark.toHex())
    })
  })
})
