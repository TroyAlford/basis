import { Shape } from './Shape'

type Props = Shape['props'] & {
  /** [x, y] coordinates of the center of the circle */
  position: [number, number],
  /** Radius */
  radius: number,
}

export class Circle extends Shape<Props> {
  static displayName = 'Circle'

  get tag() { return 'circle' as const }

  get attributes() {
    return {
      ...super.attributes,
      cx: this.props.position[0],
      cy: this.props.position[1],
      r: this.props.radius,
    }
  }
}
