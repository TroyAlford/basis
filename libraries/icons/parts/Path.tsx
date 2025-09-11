import { LineCap } from '../types/LineCap'
import { LineJoin } from '../types/LineJoin'
import { Shape } from './Shape'

type Props = Shape['props'] & {
  /** SVG path data */
  d: string,
  /** Line cap style */
  lineCap?: LineCap,
  /** Line join style */
  lineJoin?: LineJoin,
}

export class Path extends Shape<Props> {
  static displayName = 'Path'

  static get defaultProps() {
    return {
      ...super.defaultProps,
      lineCap: LineCap.Round,
      lineJoin: LineJoin.Round,
    }
  }

  get tag() { return 'path' as const }

  get attributes() {
    return {
      ...super.attributes,
      d: this.props.d,
      strokeLinecap: this.props.lineCap,
      strokeLinejoin: this.props.lineJoin,
    }
  }
}
