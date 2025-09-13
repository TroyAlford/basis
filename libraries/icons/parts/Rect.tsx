import { Shape } from './Shape'

type Props = Shape['props'] & {
  /** Height */
  height: number,
  /** Corner radius X */
  rx?: number,
  /** Corner radius Y */
  ry?: number,
  /** Width */
  width: number,
  /** X coordinate */
  x: number,
  /** Y coordinate */
  y: number,
}

export class Rect extends Shape<Props> {
  static displayName = 'Rect'

  get tag() { return 'rect' as const }

  get attributes() {
    return {
      ...super.attributes,
      height: this.props.height,
      rx: this.props.rx,
      ry: this.props.ry,
      width: this.props.width,
      x: this.props.x,
      y: this.props.y,
    }
  }
}
