import { Color } from '../../../utilities/functions/Color'
import { DEFAULT_THEME } from '../Theme/Theme'

/** The resolved Basis design tokens a diagram theme is derived from. */
export interface MermaidTokens {
  /** Surface color from `--basis-color-background`. */
  background: string,
  /** Base font size in pixels, resolved from `--basis-font-size-md`. */
  fontSize: number,
  /** Body text color from `--basis-color-foreground`. */
  foreground: string,
  /** Brand accent from `--basis-color-primary`. */
  primary: string,
}

/** The Mermaid configuration object the runtime consumes. */
export type MermaidConfig = Record<string, unknown>

/** The pixels a `100%` font-size token resolves to. */
const BASE_FONT_SIZE = 16

/** The categorical accents used by pie, timeline, and git-graph surfaces. */
const CATEGORICAL = [
  '#0070f3',
  '#00b8d4',
  '#16a34a',
  '#eab308',
  '#f97316',
  '#e11d48',
  '#8b5cf6',
  '#ec4899',
  '#0ea5e9',
  '#14b8a6',
  '#84cc16',
  '#f59e0b',
]

/** The layout geometry shared by every diagram. */
const GEOMETRY: MermaidConfig = {
  flowchart: {
    curve: 'basis',
    htmlLabels: true,
    nodeSpacing: 44,
    padding: 14,
    rankSpacing: 48,
    useMaxWidth: true,
  },
  fontFamily: "'Ubuntu', sans-serif",
  gantt: {
    barGap: 6,
    barHeight: 26,
    fontSize: 14,
    gridLineStartPadding: 40,
    topPadding: 52,
    useMaxWidth: true,
  },
  journey: { useMaxWidth: true },
  layout: 'elk',
  look: 'neo',
  pie: { useMaxWidth: true },
  quadrantChart: { useMaxWidth: true },
  sequence: {
    actorMargin: 64,
    boxMargin: 12,
    diagramMarginX: 24,
    diagramMarginY: 16,
    mirrorActors: false,
    useMaxWidth: true,
    wrap: true,
  },
}

/** The palette every diagram surface is painted from. */
interface MermaidPalette {
  /** Brand accent, for active or special states. */
  accent: Color,
  /** Diagram background. */
  background: Color,
  /** Node, actor, and title border. */
  border: Color,
  /** Categorical accents, in order. */
  categorical: Color[],
  /** Subgraph and alternate-row fill. */
  cluster: Color,
  /** Subgraph and alternate-row border. */
  clusterBorder: Color,
  /** Edges, arrows, and lines. */
  line: Color,
  /** Notes and tertiary fill. */
  muted: Color,
  /** Notes and tertiary border. */
  mutedBorder: Color,
  /** Node, actor, and title fill. */
  surface: Color,
  /** Body text. */
  text: Color,
}

/**
 * Mix two colors in sRGB.
 * @param from - The color to start from.
 * @param to - The color to move toward.
 * @param weight - The share of `to`, from 0 to 1.
 * @returns The mixed color.
 */
function mix(from: Color, to: Color, weight: number): Color {
  const start = from.toRGB()
  const end = to.toRGB()
  const channel = (a: number, b: number) => Math.round((a * (1 - weight)) + (b * weight))
  return Color.fromRGB(channel(start.r, end.r), channel(start.g, end.g), channel(start.b, end.b))
}

/**
 * Derive the palette from the resolved Basis tokens.
 *
 * Every color is mixed toward the token background, so the same derivation
 * adapts to a light or dark theme: a dark `background` yields dark node fills
 * against light text, and the reverse on a light theme.
 * @param tokens - The resolved Basis tokens.
 * @returns The palette.
 */
function resolvePalette(tokens: MermaidTokens): MermaidPalette {
  const background = Color.from(tokens.background)
  const foreground = Color.from(tokens.foreground)
  const primary = Color.from(tokens.primary)
  return {
    accent: primary,
    background,
    border: primary,
    categorical: CATEGORICAL.map(value => Color.from(value)),
    cluster: mix(primary, background, 0.93),
    clusterBorder: mix(primary, background, 0.6),
    line: mix(foreground, background, 0.32),
    muted: mix(foreground, background, 0.95),
    mutedBorder: mix(foreground, background, 0.8),
    surface: mix(primary, background, 0.86),
    text: foreground,
  }
}

/**
 * Map a palette to Mermaid's `themeVariables`.
 * @param palette - The palette to translate.
 * @param tokens - The resolved Basis tokens.
 * @returns The theme variables.
 */
function themeVariables(palette: MermaidPalette, tokens: MermaidTokens): Record<string, string | boolean> {
  const color = (value: Color) => value.toRGBString()
  const variables: Record<string, string | boolean> = {
    activationBkgColor: color(palette.cluster),
    activationBorderColor: color(palette.border),
    actorBkg: color(palette.surface),
    actorBorder: color(palette.border),
    actorLineColor: color(palette.line),
    actorTextColor: color(palette.text),
    altBackground: color(palette.cluster),
    arrowheadColor: color(palette.line),
    attributeBackgroundColorEven: color(palette.cluster),
    attributeBackgroundColorOdd: color(palette.background),
    background: color(palette.background),
    classText: color(palette.text),
    clusterBkg: color(palette.cluster),
    clusterBorder: color(palette.clusterBorder),
    commitLabelBackground: color(palette.muted),
    commitLabelColor: color(palette.text),
    compositeBackground: color(palette.cluster),
    compositeTitleBackground: color(palette.border),
    critBkgColor: '#dc2626',
    critBorderColor: '#dc2626',
    edgeLabelBackground: color(palette.background),
    fontFamily: GEOMETRY.fontFamily as string,
    fontSize: `${tokens.fontSize}px`,
    gridColor: color(palette.line),
    labelBackgroundColor: color(palette.surface),
    labelBoxBkgColor: color(palette.surface),
    labelBoxBorderColor: color(palette.border),
    labelTextColor: color(palette.text),
    lineColor: color(palette.line),
    loopTextColor: color(palette.text),
    mainBkg: color(palette.surface),
    nodeBorder: color(palette.border),
    nodeTextColor: color(palette.text),
    noteBkgColor: color(palette.muted),
    noteBorderColor: color(palette.mutedBorder),
    noteTextColor: color(palette.text),
    pieLegendTextColor: color(palette.text),
    pieOpacity: '1',
    pieOuterStrokeColor: color(palette.background),
    pieSectionTextColor: color(palette.text),
    pieStrokeColor: color(palette.background),
    pieTitleTextColor: color(palette.text),
    primaryBorderColor: color(palette.border),
    primaryColor: color(palette.surface),
    primaryTextColor: color(palette.text),
    secondaryColor: color(palette.cluster),
    secondaryTextColor: color(palette.text),
    sectionBkgColor: color(palette.cluster),
    sequenceNumberColor: color(palette.background),
    signalColor: color(palette.line),
    signalTextColor: color(palette.text),
    stateBkg: color(palette.surface),
    stateLabelColor: color(palette.text),
    tagLabelBackground: color(palette.cluster),
    tagLabelBorder: color(palette.border),
    tagLabelColor: color(palette.text),
    taskBkgColor: color(palette.accent),
    taskBorderColor: color(palette.accent),
    taskTextColor: color(palette.background),
    taskTextDarkColor: color(palette.text),
    taskTextLightColor: color(palette.background),
    taskTextOutsideColor: color(palette.text),
    tertiaryColor: color(palette.muted),
    tertiaryTextColor: color(palette.text),
    textColor: color(palette.text),
    titleColor: color(palette.text),
    todayLineColor: color(palette.accent),
    transitionColor: color(palette.line),
    transitionLabelColor: color(palette.text),
  }

  palette.categorical.forEach((value, index) => {
    const accent = color(value)
    /*
     * Pie and git graphs need distinct hues; mindmap and timeline read better
     * as a single ramp of the brand accent, so they get their own scale.
     */
    const shade = mix(
      palette.accent,
      palette.background,
      ((index / Math.max(palette.categorical.length - 1, 1)) ** 0.6) * 0.62,
    )
    variables[`cScale${index}`] = color(shade)
    variables[`cScaleLabel${index}`] = color(shade.contrast())
    variables[`git${index % 8}`] = accent
    variables[`gitBranchLabel${index % 8}`] = color(value.contrast())
    variables[`pie${index + 1}`] = accent
  })

  return variables
}

/**
 * Build the theme CSS that pins the diagram surfaces Mermaid draws from its
 * built-in palette rather than the `pie…`, `quadrant…`, and ER row variables.
 *
 * `themeCSS` is emitted into the SVG, so these rules win over the renderer's
 * presentation attributes and inline styles (the legend swatch fill and the
 * quadrant point fill need `!important`).
 * @param palette - The palette to translate.
 * @returns The diagram stylesheet.
 */
function diagramCSS(palette: MermaidPalette): string {
  const color = (value: Color) => value.toRGBString()
  const slices = palette.categorical.flatMap((value, index) => {
    const fill = color(value)
    return [
      `.pieCircle:nth-of-type(${index + 1}) { fill: ${fill}; }`,
      `.legend rect:nth-of-type(${index + 1}) { fill: ${fill} !important; stroke: ${fill} !important; }`,
    ]
  })

  return [
    ...slices,
    // Entity relationship headers and rows.
    `.outer-path path:first-child { fill: ${color(palette.cluster)}; }`,
    `.outer-path path:last-child { stroke: ${color(palette.border)}; }`,
    `.row-rect-odd path { fill: ${color(palette.background)}; }`,
    `.row-rect-even path { fill: ${color(mix(palette.cluster, palette.background, 0.5))}; }`,
    `.row-rect-odd path:last-child, .row-rect-even path:last-child { stroke: ${color(palette.clusterBorder)}; }`,
    `.divider { stroke: ${color(palette.clusterBorder)}; }`,
    // Quadrant fills, border, and points.
    `.quadrant:nth-of-type(odd) { fill: ${color(mix(palette.cluster, palette.background, 0.45))}; }`,
    `.quadrant:nth-of-type(even) { fill: ${color(palette.background)}; }`,
    `.border { stroke: ${color(palette.clusterBorder)}; }`,
    `.data-point circle { fill: ${color(palette.accent)}; stroke: ${color(palette.background)}; }`,
    // Labels on the surfaces above.
    `.label, .label.name { fill: ${color(palette.text)}; }`,
  ].join('\n')
}

/**
 * Build the Mermaid configuration from Basis tokens.
 *
 * There is no Mermaid-specific theme API: a diagram is painted from whatever
 * `Theme` surrounds it. Use the base component's `theme` prop to render inside
 * a named `Theme` scope.
 * @param tokens - The resolved Basis tokens.
 * @returns The Mermaid configuration.
 */
export function mermaidConfig(tokens: MermaidTokens): MermaidConfig {
  const colors = resolvePalette(tokens)
  return {
    ...GEOMETRY,
    theme: 'base',
    themeCSS: diagramCSS(colors),
    themeVariables: {
      ...themeVariables(colors, tokens),
      darkMode: colors.background.toHSL().l < 50,
    },
  }
}

/**
 * Read the Basis tokens a diagram is themed from.
 *
 * Values come from the element's computed style, so a diagram inside a scoped
 * `[data-theme]` subtree follows that theme; each token falls back to the
 * library default when the surrounding theme does not define it.
 * @param element - The element to resolve the tokens against.
 * @returns The resolved tokens.
 */
export function readMermaidTokens(element: Element): MermaidTokens {
  const computed = getComputedStyle(element)
  const token = (name: string, fallback: string): string => {
    const value = computed.getPropertyValue(name).trim()
    return value === '' ? fallback : value
  }
  const percent = Number.parseFloat(token('--basis-font-size-md', '100%'))
  return {
    background: token('--basis-color-background', '#ffffff'),
    fontSize: Number.isFinite(percent) ? (percent / 100) * BASE_FONT_SIZE : BASE_FONT_SIZE,
    foreground: token('--basis-color-foreground', '#171717'),
    primary: token('--basis-color-primary', '#0070f3'),
  }
}

/**
 * The default tokens, for callers without a document (the static docs build).
 * @returns The tokens the unnamed `Theme` would emit.
 */
export function defaultMermaidTokens(): MermaidTokens {
  return {
    background: DEFAULT_THEME.color.background,
    fontSize: (DEFAULT_THEME.fontSize.md / 100) * BASE_FONT_SIZE,
    foreground: DEFAULT_THEME.color.foreground,
    primary: DEFAULT_THEME.color.primary,
  }
}
