import { Component } from '../../components/Component/Component'

interface Props {
  /** Custom color override */
  color?: string,
  /** Whether to fill the shape */
  fill?: boolean,
  /** SVG mask reference */
  mask?: string,
  /** Stroke width (number) */
  stroke?: number,
}

export abstract class Shape<P extends Props = Props> extends Component<P, SVGElement> {
  static get defaultProps() {
    return {
      ...super.defaultProps,
      color: 'var(--basis-icon-color, currentColor)',
      fill: false,
      stroke: 10,
    }
  }

  get attributes() {
    const { color, fill, mask, stroke, style } = this.props
    return {
      ...super.attributes,
      fill: fill ? color : 'transparent',
      mask,
      stroke: color,
      strokeWidth: stroke,
      /*
       * A stroked part reads its width through a token so an icon set can be
       * made heavier at a given size without editing every icon. Cutout details
       * (`stroke: 0`) keep their zero width. The fallback preserves the icon's
       * own width when the token is unset.
       */
      ...(stroke ? { style: { ...style, strokeWidth: `var(--basis-icon-stroke-width, ${stroke})` } } : {}),
    }
  }
}
