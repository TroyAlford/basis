import type * as React from 'react'
import { Color } from '../../../utilities/functions/Color'
import { kebabCase } from '../../../utilities/functions/kebabCase'
import { merge } from '../../../utilities/functions/merge'
import { style } from '../../utilities/style'
import { Component } from '../Component/Component'

interface Props {
  /** Colors */
  color?: {
    /** Page/application background color */
    background?: string,
    /** Border color for controls and surfaces */
    border?: string,
    /** Muted border color for dividers and table rules */
    borderSubtle?: string,
    /** Semantic danger / destructive accent (dialogs, notifications) */
    danger?: string,
    /** Disabled state color */
    disabled?: string,
    /** Disabled text color */
    disabledText?: string,
    /** Focus ring color */
    focus?: string,
    /** Foreground/text color */
    foreground?: string,
    /** Secondary/less prominent text color */
    foregroundMuted?: string,
    /** Hover state background color */
    hover?: string,
    /** Dark overlay color */
    overlayDark?: string,
    /** Light overlay color */
    overlayLight?: string,
    /** Primary brand color */
    primary?: string,
    /** Selected state background color */
    selection?: string,
    /** Semantic success accent (dialogs, notifications) */
    success?: string,
    /** Base surface color for controls and content */
    surface?: string,
    /** Alternating surface color for striped content such as table rows */
    surfaceAlt?: string,
    /** Elevated surface color for dialogs and popup menus */
    surfaceElevated?: string,
    /** Inset surface color for prefixes, suffixes, and similar chrome */
    surfaceInset?: string,
  },

  /** Font sizes relative to base size (16px) */
  fontSize?: {
    /** Large font size (in %) */
    lg?: number,
    /** Medium font size (in %) */
    md?: number,
    /** Small font size (in %) */
    sm?: number,
    /** Extra large font size (in %) */
    xl?: number,
    /** Extra small font size (in %) */
    xs?: number,
    /** Extra extra large font size (in %) */
    xxl?: number,
    /** Extra extra small font size (in %) */
    xxs?: number,
  },

  /** The name of this theme, used for namespacing CSS variables */
  name?: string,

  /** Border radii */
  radius?: {
    /** Large border radius (in px) */
    lg?: number,
    /** Medium border radius (in px) */
    md?: number,
    /** Circular border radius */
    round?: number,
    /** Small border radius (in px) */
    sm?: number,
  },

  /** Box shadows */
  shadow?: {
    /** Large shadow */
    lg?: string,
    /** Medium shadow */
    md?: string,
    /** Small shadow */
    sm?: string,
  },

  /** Transition timings */
  transition?: {
    /** Fast transition */
    fast?: string,
    /** Medium transition */
    medium?: string,
    /** Slow transition */
    slow?: string,
  },

  /** Base spacing units */
  unit?: {
    /** Large unit (in px) */
    lg?: number,
    /** Medium unit (in px) */
    md?: number,
    /** Small unit (in px) */
    sm?: number,
    /** Extra large unit (in px) */
    xl?: number,
    /** Extra small unit (in px) */
    xs?: number,
    /** Extra extra large unit (in px) */
    xxl?: number,
    /** Extra extra small unit (in px) */
    xxs?: number,
  },
}

/**
 * The theme applied when no overrides are supplied. Exported so tooling that
 * cannot read CSS variables (for example the static documentation build) can
 * resolve the same tokens a mounted `Theme` would emit.
 */
export const DEFAULT_THEME = {
  color: {
    background: '#ffffff',
    border: '#171717',
    borderSubtle: '#88888880',
    danger: '#C00000',
    disabled: '#e5e5e5',
    disabledText: '#a3a3a3',
    focus: '#0070f3',
    foreground: '#171717',
    foregroundMuted: '#666666',
    hover: '#0070f340',
    overlayDark: '#00000080',
    overlayLight: '#ffffff80',
    primary: '#0070f3',
    selection: '#0070f380',
    success: '#008000',
    surface: '#ffffff',
    surfaceAlt: '#dddddd',
    surfaceElevated: '#ffffff',
    surfaceInset: '#88888844',
  },
  fontSize: {
    lg: 112.5, // 16px
    md: 100, // 14px
    sm: 87.5, // 12px
    xl: 125, // 18px
    xs: 75, // 10px
    xxl: 150, // 20px
    xxs: 62.5, // 24px
  },
  radius: {
    lg: 16,
    md: 8,
    round: 50,
    sm: 4,
  },
  shadow: {
    lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
    md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
    sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  },
  transition: {
    fast: '150ms cubic-bezier(0.4, 0, 0.2, 1)',
    medium: '300ms cubic-bezier(0.4, 0, 0.2, 1)',
    slow: '500ms cubic-bezier(0.4, 0, 0.2, 1)',
  },
  unit: {
    lg: 24,
    md: 16,
    sm: 8,
    xl: 32,
    xs: 4,
    xxl: 48,
    xxs: 2,
  },
}

/**
 * The official light preset. It carries the same values as {@link DEFAULT_THEME}
 * so applications can opt into a named light theme without changing appearance.
 */
export const LIGHT_THEME = {
  ...DEFAULT_THEME,
  color: { ...DEFAULT_THEME.color },
}

/**
 * The official dark preset. It uses a neutral, substantially darker palette
 * than the legacy MTG `#30404d` chrome and separates the page background,
 * resting surfaces, elevated overlays, borders, and interactive states.
 *
 * Apply it to a subtree with `<Theme name="dark" {...DARK_THEME} />` and
 * `data-theme="dark"`.
 */
export const DARK_THEME = {
  ...LIGHT_THEME,
  color: {
    ...LIGHT_THEME.color,
    background: '#080a0d',
    border: '#3d4754',
    borderSubtle: '#2a323d',
    danger: '#f87171',
    disabled: '#1a1f26',
    disabledText: '#8b96a3',
    focus: '#7aa2f7',
    foreground: '#f3f5f7',
    foregroundMuted: '#b6c0cc',
    hover: '#1d2631',
    overlayDark: '#000000cc',
    overlayLight: '#ffffff33',
    primary: '#5b9dff',
    selection: '#1f3a5f',
    success: '#4ade80',
    surface: '#11151a',
    surfaceAlt: '#161b21',
    surfaceElevated: '#1c232b',
    surfaceInset: '#212a33',
  },
}

/**
 * A component that sets theme variables through CSS.
 * Variables are namespaced under the theme name and applied when a parent element
 * has the corresponding [theme=name] attribute.
 * @example
 * <Theme
 *   name="light"
 *   color={{ primary: "#0070f3" }}
 *   fontSize={{ md: 100 }}  // 100% = 16px
 *   unit={{ md: 16 }}
 * />
 */
export class Theme extends Component<Props> {
  static displayName = 'Theme'

  /** `color` is the Theme palette, not a native `color` attribute. */
  static ownedNativeProps = ['color']
  static defaultProps: Component<Props>['props'] = {
    ...Component.defaultProps,
    ...DEFAULT_THEME,
  }

  componentDidMount(): void { this.injectStyles() }
  componentDidUpdate(): void { this.injectStyles() }

  private injectStyles(): void {
    const themeName = this.props.name?.trim() || 'default'
    style(`basis:theme:${themeName}`, themeStyles(this.props))
  }

  override render = (): React.ReactNode => null
}

// Derived from the defaults so a new theme category is picked up automatically.
const CATEGORIES = Object.keys(DEFAULT_THEME) as (keyof typeof DEFAULT_THEME)[]

/**
 * Format a colour for use in a CSS variable.
 * @param color - The colour to format.
 * @returns The formatted colour.
 */
function processColor(color: string): string {
  return Color.from(color).toString()
}

/**
 * Render a theme category as CSS custom properties.
 * @param prefix - The category name.
 * @param values - The category values.
 * @returns The custom property declarations.
 */
function processObject(prefix: string, values: Record<string, unknown>): string[] {
  if (!values || typeof values !== 'object') return []
  const namespace = kebabCase(prefix)

  return Object.entries(values)
    .filter(([, value]) => value != null)
    .map(([key, value]) => {
      const cssKey = `--basis-${namespace}-${kebabCase(key)}`
      let cssValue = value

      if (namespace === 'font-size') {
        cssValue = `${value}%`
      } else if (namespace === 'color' && typeof value === 'string') {
        cssValue = processColor(value)
      } else if (typeof value === 'number' && !cssKey.includes('transition')) {
        cssValue = `${value}px`
      }

      return `${cssKey}: ${cssValue};`
    })
}

/**
 * Build the CSS custom properties for a theme without mounting a `Theme`.
 * @param props - Theme overrides.
 * @returns The theme stylesheet.
 */
export function themeStyles(props: Props = {}): string {
  const theme = merge<Props>(DEFAULT_THEME, props)
  const variables = CATEGORIES.flatMap(category => {
    const values = theme[category]
    return values && typeof values === 'object'
      ? processObject(category, values as Record<string, unknown>)
      : []
  })
  variables.push(`--basis-color-contrast: ${Color.from(theme.color.primary).contrast()};`)
  variables.push(`--basis-color-danger-contrast: ${Color.from(theme.color.danger).contrast()};`)
  variables.push(`--basis-color-success-contrast: ${Color.from(theme.color.success).contrast()};`)

  return props.name?.trim()
    ? `:root [data-theme="${props.name}"] { ${variables.join('\n')} }`
    : `:root { ${variables.join('\n')} }`
}
