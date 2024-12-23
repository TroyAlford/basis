import type * as React from 'react'
import { Color } from '@basis/utilities/functions/Color'
import { kebabCase } from '@basis/utilities/functions/kebabCase'
import { merge } from '@basis/utilities/functions/merge'
import { Component } from '../Component/Component'

interface Props {
  /** Colors */
  color?: {
    /** Background color */
    background?: string,
    /** Disabled state color */
    disabled?: string,
    /** Disabled text color */
    disabledText?: string,
    /** Foreground/text color */
    foreground?: string,
    /** Dark overlay color */
    overlayDark?: string,
    /** Light overlay color */
    overlayLight?: string,
    /** Primary brand color */
    primary?: string,
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

const DEFAULT_THEME = {
  color: {
    background: '#ffffff',
    disabled: '#e5e5e5',
    disabledText: '#a3a3a3',
    foreground: '#171717',
    overlayDark: '#00000080',
    overlayLight: '#ffffff80',
    primary: '#0070f3',
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
  static readonly defaultProps: Component<Props>['props'] = {
    ...Component.defaultProps,
    ...DEFAULT_THEME,
  }

  readonly tag = 'style' as const

  componentDidMount(): void {
    if (this.rootNode) this.rootNode.textContent = this.getCSSVariables()
  }

  shouldComponentUpdate(
    nextProps: Readonly<Component<Props>['props']>,
    nextState: Readonly<Component['state']>,
  ): boolean {
    if (!super.shouldComponentUpdate(nextProps, nextState)) return false
    if (this.rootNode) this.rootNode.textContent = this.getCSSVariables()
    return false
  }

  private processColor(color: string): string {
    return Color.from(color).toString()
  }

  private processObject(prefix: string, values: Record<string, unknown>): string[] {
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
          cssValue = this.processColor(value)
        } else if (typeof value === 'number' && !cssKey.includes('transition')) {
          cssValue = `${value}px`
        }

        return `${cssKey}: ${cssValue};`
      })
  }

  private getCSSVariables(): string {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { name, nodeRef, ...props } = this.props
    const { ...theme } = merge<Props>(DEFAULT_THEME, props)
    const variables = Object.entries(theme)
      .filter(([, values]) => values && typeof values === 'object')
      .flatMap(([category, values]) => this.processObject(category, values as Record<string, unknown>))

    return name?.trim()
      ? `:root [theme="${name}"] { ${variables.join('\n')} }`
      : `:root { ${variables.join('\n')} }`
  }

  content(): React.ReactNode { return null }
}
