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
    return {
      ...super.attributes,
      fill: this.props.fill ? this.props.color : 'transparent',
      mask: this.props.mask,
      stroke: this.props.color,
      strokeWidth: this.props.stroke,
    }
  }
}
