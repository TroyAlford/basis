import type * as React from 'react'
import { Align } from '../../types/Align'
import { Size } from '../../types/Size'
import { loadImage } from '../../utilities/loadImage'
import { Component } from '../Component/Component'

import './Image.styles.ts'

interface Props {
  /** Alignment value. */
  align?: Align,
  /** Alternative text for the image. */
  alt?: string,
  /** Click handler. */
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void,
  /** Mouse down handler. */
  onMouseDown?: (event: React.MouseEvent<HTMLDivElement>) => void,
  /** Touch end handler. */
  onTouchEnd?: (event: React.TouchEvent<HTMLDivElement>) => void,
  /** Touch move handler. */
  onTouchMove?: (event: React.TouchEvent<HTMLDivElement>) => void,
  /** Touch start handler. */
  onTouchStart?: (event: React.TouchEvent<HTMLDivElement>) => void,
  /** Size value. */
  size?: Size,
  /** Source URL. */
  src: string,
}

interface State {
  /** Error state. */
  error: boolean,
  /** Loading state. */
  loading: boolean,
}

/** A component for displaying an image with proper alignment and sizing. */
export class Image extends Component<Props, HTMLDivElement, State> {
  /** Align values. */
  static Align = Align
  /** Size values. */
  static Size = Size

  static displayName = 'Image'
  static defaultProps = {
    ...Component.defaultProps,
    align: Align.Center,
    size: Size.Natural,
  }

  get tag(): keyof React.JSX.IntrinsicElements { return 'div' }

  get defaultState(): State {
    return {
      error: false,
      loading: true,
    }
  }

  get attributes() {
    const { align, size, src } = this.props
    const { error, loading } = this.state

    // Base attributes
    const baseAttributes = {
      ...super.attributes,
      'aria-label': this.props.alt || undefined,
      'data-align': align,
      'data-error': error,
      'data-loaded': !loading && !error,
      'data-loading': loading,
      'data-size': size,
      'onClick': this.props.onClick,
      'onMouseDown': this.props.onMouseDown,
      'onTouchEnd': this.props.onTouchEnd,
      'onTouchMove': this.props.onTouchMove,
      'onTouchStart': this.props.onTouchStart,
      'role': this.props.alt ? 'img' : undefined,
      'style': {
        backgroundImage: `url(${src})`,
        backgroundPosition: align,
        backgroundSize: size,
      },
    } as Component<Props, HTMLDivElement, State>['attributes']
      & { style: React.CSSProperties }

    return baseAttributes
  }

  componentDidMount(): void {
    this.loadImage()
  }

  componentDidUpdate(prevProps: Props): void {
    if (prevProps.src !== this.props.src) {
      this.loadImage()
    }
  }

  /** Loads an image and updates the component state when it's ready. */
  private loadImage = async (): Promise<void> => {
    const { src } = this.props

    await this.setState({ error: false, loading: true })
    const image = await loadImage(src)
    if (this.props.size === Size.Natural && image) {
      this.rootNode.style.height = `${CSS.px(image.height)}`
      this.rootNode.style.width = `${CSS.px(image.width)}`
    }
    await this.setState({ error: !image, loading: false })
  }

  /**
   * Returns null, because the div container handles the image display.
   * @returns null
   */
  content(): null { return null }
}
