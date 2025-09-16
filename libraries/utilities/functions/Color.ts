interface RGB {
  /** alpha channel, 0-1 */
  a?: number,
  /** blue channel, 0-255 */
  b: number,
  /** green channel, 0-255 */
  g: number,
  /** red channel, 0-255 */
  r: number,
}

interface HSV {
  /** alpha channel, 0-1 */
  a?: number,
  /** hue channel, 0-360 */
  h: number,
  /** saturation channel, 0-100 */
  s: number,
  /** value channel, 0-100 */
  v: number,
}

interface HSL {
  /** alpha channel, 0-1 */
  a?: number,
  /** hue channel, 0-360 */
  h: number,
  /** lightness channel, 0-100 */
  l: number,
  /** saturation channel, 0-100 */
  s: number,
}

const COLOR_FORMATS = {
  hex: /^#?(?<r>[0-9a-f]{2})(?<g>[0-9a-f]{2})(?<b>[0-9a-f]{2})(?<a>[0-9a-f]{2})?$/i,
  hsl: /^hsla?\(\s*(?<h>\d+)\s*,\s*(?<s>\d+)%?\s*,\s*(?<l>\d+)%?\s*(?:,\s*(?<a>[\d.]+)\s*)?\)$/i,
  hsv: /^hsva?\(\s*(?<h>\d+)\s*,\s*(?<s>\d+)%?\s*,\s*(?<v>\d+)%?\s*(?:,\s*(?<a>[\d.]+)\s*)?\)$/i,
  rgb: /^rgba?\(\s*(?<r>\d+)\s*,\s*(?<g>\d+)\s*,\s*(?<b>\d+)\s*(?:,\s*(?<a>[\d.]+)\s*)?\)$/i,
} as const

/**
 * A class for handling color conversions and manipulations.
 * Internally stores colors in RGBA format for consistency.
 * @example
 * // Create a color via the constructor
 * const color = new Color(255, 0, 0, 1) // r, g, b, a
 */
export class Color {
  private constructor(
    /** red channel, 0-255 */
    private readonly red: number,
    /** green channel, 0-255 */
    private readonly green: number,
    /** blue channel, 0-255 */
    private readonly blue: number,
    /** alpha channel, 0-1 */
    private readonly alpha = 1,
  ) {
    this.validate()
  }

  /**
   * Creates a Color from an RGB string or object
   * @example
   * // From object
   * Color.fromRGB({ r: 255, g: 0, b: 0 })
   * // From string
   * Color.fromRGB('rgb(255, 0, 0)')
   * Color.fromRGB('rgba(255, 0, 0, 0.5)')
   */
  static fromRGB(rgb: RGB | string): Color

  /**
   * Creates a Color from RGB values
   * @example
   * Color.fromRGB(255, 0, 0)
   * Color.fromRGB(255, 0, 0, 0.5)
   */
  static fromRGB(r: number, g: number, b: number, a?: number): Color

  static fromRGB(value: number | string | RGB, g?: number, b?: number, a = 1): Color {
    if (typeof value === 'string') {
      const match = COLOR_FORMATS.rgb.exec(value.trim())
      if (!match?.groups) throw new Error(`Invalid RGB string: ${value}`)
      const { a: alpha, b: blue, g: green, r: red } = match.groups
      return new Color(+red, +green, +blue, alpha ? +alpha : 1)
    }

    if (typeof value === 'object') {
      return new Color(
        value.r,
        value.g,
        value.b,
        value.a ?? 1,
      )
    }

    return new Color(value, g || 0, b || 0, a)
  }

  /**
   * Creates a Color from an HSV string or object
   * @example
   * // From object
   * Color.fromHSV({ h: 360, s: 100, v: 100 })
   * // From string
   * Color.fromHSV('hsv(360, 100%, 100%)')
   * Color.fromHSV('hsva(360, 100%, 100%, 0.5)')
   */
  static fromHSV(hsv: HSV | string): Color

  /**
   * Creates a Color from HSV values
   * @example
   * Color.fromHSV(360, 100, 100)
   * Color.fromHSV(360, 100, 100, 0.5)
   */
  static fromHSV(h: number, s: number, v: number, a?: number): Color

  static fromHSV(value: number | string | HSV, s?: number, v?: number, a = 1): Color {
    if (typeof value === 'string') {
      const match = COLOR_FORMATS.hsv.exec(value.trim())
      if (!match?.groups) throw new Error(`Invalid HSV string: ${value}`)
      const { a: alpha, h: hue, s: sat, v: val } = match.groups
      return Color.fromHSV(+hue, +sat, +val, alpha ? +alpha : 1)
    }

    if (typeof value === 'object') {
      return Color.fromHSV(
        value.h,
        value.s,
        value.v,
        value.a ?? 1,
      )
    }

    // Normalize values
    const hue = value / 360
    const sat = (s || 0) / 100
    const val = (v || 0) / 100

    let r = 0
    let g = 0
    let b = 0

    const i = Math.floor((hue * 6))
    const f = (hue * 6) - i
    const p = val * (1 - sat)
    const q = val * (1 - (f * sat))
    const t = val * (1 - ((1 - f) * sat))

    switch (i % 6) {
      case 0: r = val; g = t; b = p; break
      case 1: r = q; g = val; b = p; break
      case 2: r = p; g = val; b = t; break
      case 3: r = p; g = q; b = val; break
      case 4: r = t; g = p; b = val; break
      case 5: r = val; g = p; b = q; break
    }

    return new Color(
      Math.round(r * 255),
      Math.round(g * 255),
      Math.round(b * 255),
      a,
    )
  }

  /**
   * Creates a Color from an HSL string or object
   * @example
   * // From object
   * Color.fromHSL({ h: 360, s: 100, l: 50 })
   * // From string
   * Color.fromHSL('hsl(360, 100%, 50%)')
   * Color.fromHSL('hsla(360, 100%, 50%, 0.5)')
   */
  static fromHSL(hsl: HSL | string): Color

  /**
   * Creates a Color from HSL values
   * @example
   * Color.fromHSL(360, 100, 50)
   * Color.fromHSL(360, 100, 50, 0.5)
   */
  static fromHSL(h: number, s: number, l: number, a?: number): Color

  static fromHSL(value: number | string | HSL, s?: number, l?: number, a = 1): Color {
    if (typeof value === 'string') {
      const match = COLOR_FORMATS.hsl.exec(value.trim())
      if (!match?.groups) throw new Error(`Invalid HSL string: ${value}`)
      const { a: alpha, h: hue, l: light, s: sat } = match.groups
      return Color.fromHSL(+hue, +sat, +light, alpha ? +alpha : 1)
    }

    if (typeof value === 'object') {
      return Color.fromHSL(
        value.h,
        value.s,
        value.l,
        value.a ?? 1,
      )
    }

    // Normalize values
    const hue = value / 360
    const sat = (s || 0) / 100
    const light = (l || 0) / 100

    let r = 0
    let g = 0
    let b = 0

    if (sat === 0) {
      r = g = b = light
    } else {
      const hue2rgb = (p: number, q: number, t: number) => {
        if (t < 0) t += 1
        if (t > 1) t -= 1
        if (t < (1 / 6)) return p + ((q - p) * 6 * t)
        if (t < (1 / 2)) return q
        if (t < (2 / 3)) return p + ((q - p) * ((2 / 3) - t) * 6)
        return p
      }

      const q = light < 0.5
        ? (light * (1 + sat))
        : (light + sat - (light * sat))
      const p = (2 * light) - q

      r = hue2rgb(p, q, hue + (1 / 3))
      g = hue2rgb(p, q, hue)
      b = hue2rgb(p, q, hue - (1 / 3))
    }

    return new Color(
      Math.round(r * 255),
      Math.round(g * 255),
      Math.round(b * 255),
      a,
    )
  }

  /**
   * Creates a Color from a hex string
   * @param hex - The hex string to create the color from
   * @returns A Color instance
   * @example
   * Color.fromHex('#ff0000')    // With #
   * Color.fromHex('ff0000')     // Without #
   * Color.fromHex('#ff0000ff')  // With alpha
   */
  static fromHex(hex: string): Color {
    // Remove # if present, ensure lowercase, and trim whitespace
    hex = hex.replace(/^#/, '').toLowerCase().trim()

    // Add alpha channel if missing
    if (hex.length === 6) hex = `${hex}ff`

    const match = COLOR_FORMATS.hex.exec(hex)
    if (!match?.groups) throw new Error(`Invalid hex color: ${hex}`)

    const { a, b, g, r } = match.groups
    return new Color(
      parseInt(r, 16),
      parseInt(g, 16),
      parseInt(b, 16),
      Math.round((a ? parseInt(a, 16) / 255 : 1) * 100) / 100,
    )
  }

  /**
   * Creates a Color from any supported color string format
   * @param color - The color string to create the color from
   * @returns A Color instance
   * @example
   * Color.from('#ff0000')            // Hex
   * Color.from('rgb(255, 0, 0)')     // RGB
   * Color.from('hsv(0, 100%, 100%)') // HSV
   * Color.from('hsl(0, 100%, 50%)')  // HSL
   */
  static from(color: string): Color {
    for (const [format, regex] of Object.entries(COLOR_FORMATS)) {
      if (regex.test(color)) {
        if (format === 'hex') return Color.fromHex(color)
        if (format === 'rgb') return Color.fromRGB(color)
        if (format === 'hsv') return Color.fromHSV(color)
        if (format === 'hsl') return Color.fromHSL(color)
      }
    }

    throw new Error(`Invalid color format: ${color}`)
  }

  /** Validates the color values */
  private validate(): void {
    const isValid = (
      this.red >= 0 && this.red <= 255
      && this.green >= 0 && this.green <= 255
      && this.blue >= 0 && this.blue <= 255
      && this.alpha >= 0 && this.alpha <= 1
    )
    if (!isValid) throw new Error(`Invalid color values: rgb(${this.red}, ${this.green}, ${this.blue}, ${this.alpha})`)
  }

  /**
   * Returns the color as an RGB object
   * @returns An RGB object
   * @example color.toRGB() // { r: 255, g: 0, b: 0, a: 1 }
   */
  toRGB(): RGB {
    return { a: this.alpha, b: this.blue, g: this.green, r: this.red }
  }

  /**
   * Returns the color as an HSV object
   * @returns An HSV object
   * @example color.toHSV() // { h: 0, s: 100, v: 100, a: 1 }
   */
  toHSV(): HSV {
    const r = this.red / 255
    const g = this.green / 255
    const b = this.blue / 255

    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const d = max - min
    let h = 0
    const s = max === 0 ? 0 : (d / max)
    const v = max

    if (max !== min) {
      switch (max) {
        case r: h = ((g - b) / d) + (g < b ? 6 : 0); break
        case g: h = ((b - r) / d) + 2; break
        case b: h = ((r - g) / d) + 4; break
      }
      h = h / 6
    }

    return {
      a: this.alpha,
      h: Math.round(h * 360),
      s: Math.round(s * 100),
      v: Math.round(v * 100),
    }
  }

  /**
   * Returns the color as an HSL object
   * @returns An HSL object
   * @example color.toHSL() // { h: 0, s: 100, l: 50, a: 1 }
   */
  toHSL(): HSL {
    const r = this.red / 255
    const g = this.green / 255
    const b = this.blue / 255

    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    let h = 0
    let s = 0
    const l = (max + min) / 2

    if (max !== min) {
      const d = max - min
      s = l > 0.5
        ? (d / ((2 - max) - min))
        : (d / (max + min))

      switch (max) {
        case r: h = ((g - b) / d) + (g < b ? 6 : 0); break
        case g: h = ((b - r) / d) + 2; break
        case b: h = ((r - g) / d) + 4; break
      }
      h = h / 6
    }

    return {
      a: this.alpha,
      h: Math.round(h * 360),
      l: Math.round(l * 100),
      s: Math.round(s * 100),
    }
  }

  /**
   * Returns the color as a hex string with alpha
   * @returns A hex string
   * @example color.toHex() // '#ff0000ff'
   */
  toHex(): string {
    const hex = (n: number) => n.toString(16).padStart(2, '0')
    return `#${hex(this.red)}${hex(this.green)}${hex(this.blue)}${hex(Math.round(this.alpha * 255))}`
  }

  /**
   * Returns the color as an rgb/rgba string
   * @returns An rgb/rgba string
   * @example color.toRGBString() // 'rgb(255, 0, 0)' or 'rgba(255, 0, 0, 0.5)'
   */
  toRGBString(): string {
    return this.alpha === 1
      ? `rgb(${this.red}, ${this.green}, ${this.blue})`
      : `rgba(${this.red}, ${this.green}, ${this.blue}, ${this.alpha})`
  }

  /**
   * Returns the color as an hsv/hsva string
   * @returns An hsv/hsva string
   * @example color.toHSVString() // 'hsv(0, 100%, 100%)' or 'hsva(0, 100%, 100%, 0.5)'
   */
  toHSVString(): string {
    const { a, h, s, v } = this.toHSV()
    return a === 1
      ? `hsv(${h}, ${s}%, ${v}%)`
      : `hsva(${h}, ${s}%, ${v}%, ${a})`
  }

  /**
   * Returns the color as an hsl/hsla string
   * @returns An hsl/hsla string
   * @example color.toHSLString() // 'hsl(0, 100%, 50%)' or 'hsla(0, 100%, 50%, 0.5)'
   */
  toHSLString(): string {
    const { a, h, l, s } = this.toHSL()
    return a === 1
      ? `hsl(${h}, ${s}%, ${l}%)`
      : `hsla(${h}, ${s}%, ${l}%, ${a})`
  }

  /**
   * Returns the color as a hex string with alpha
   * @returns A hex string
   * @example color.toString() // '#ff0000ff'
   */
  toString(): string {
    return this.toHex()
  }

  /**
   * Computes a contrast color for this color.
   * Returns a dark gray for light colors and a light gray for dark colors.
   * @param onDark Optional color to contrast against dark hues
   * @param onLight Optional color to contrast against light hues
   * @returns A Color instance with appropriate contrast
   * @example
   * Color.fromHex('#ffffff').contrast() // Returns onLight
   * Color.fromHex('#000000').contrast() // Returns onDark
   */
  contrast(
    onDark = Color.fromHex('#ffffff'),
    onLight = Color.fromHex('#000000'),
  ): Color {
    // Convert to RGB to compute luminance
    const r = this.red / 255
    const g = this.green / 255
    const b = this.blue / 255

    // Compute relative luminance using the standard formula
    const luminance = (0.2126 * r) + (0.7152 * g) + (0.0722 * b)

    /*
     * If luminance is high (light color), return dark gray
     * If luminance is low (dark color), return light gray
     */
    if (luminance > 0.5) {
      // Light color - return dark gray with alpha
      return onLight
    } else {
      // Dark color - return light gray with alpha
      return onDark
    }
  }
}
