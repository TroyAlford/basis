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
  /** Image dimensions. */
  dimensions: { height: number, width: number } | null,
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
  /** Cache for loading and resolved images. */
  static Cache = {
    /** Map of loading promises for images. */
    Loading: new Map<string, Promise<HTMLImageElement>>(),
    /** Map of resolved images. */
    Resolved: new Map<string, HTMLImageElement>(),
  }

  static displayName = 'Image'
  static defaultProps = {
    ...Component.defaultProps,
    align: Align.Center,
    size: Size.Natural,
  }

  get tag(): keyof React.JSX.IntrinsicElements { return 'div' }

  get defaultState(): State {
    return {
      dimensions: null,
      error: false,
      loading: true,
    }
  }

  get attributes() {
    const { align, size, src } = this.props
    const { dimensions, error, loading } = this.state

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
      'style': {},
    } as Component<Props, HTMLDivElement, State>['attributes']
      & { style: React.CSSProperties }

    // Add inline styles for background image and sizing
    if (error) {
      baseAttributes.style = {
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundSize: 'contain',
      }
    } else if (loading || !dimensions) {
      baseAttributes.style = {
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundSize: 'contain',
      }
    } else {
      // Image is loaded, set background image and positioning
      const backgroundSize = this.getBackgroundSize(size, dimensions)
      const backgroundPosition = this.getBackgroundPosition(align)

      // Container sizing based on mode
      const containerStyles: React.CSSProperties = {}

      switch (size) {
        case Size.Natural:
          // Resize div to match image dimensions
          containerStyles.width = `${dimensions.width}px`
          containerStyles.height = `${dimensions.height}px`
          containerStyles.minWidth = 'auto'
          containerStyles.minHeight = 'auto'
          break
        case Size.Contain:
          // Expand div to fill container, image will be constrained
          containerStyles.width = '100%'
          containerStyles.height = '100%'
          containerStyles.minWidth = '100px'
          containerStyles.minHeight = '100px'
          break
        case Size.Fill:
          // Expand div to completely fill container
          containerStyles.width = '100%'
          containerStyles.height = '100%'
          containerStyles.minWidth = '100px'
          containerStyles.minHeight = '100px'
          break
      }

      baseAttributes.style = {
        ...containerStyles,
        backgroundImage: `url(${src})`,
        backgroundPosition,
        backgroundRepeat: 'no-repeat',
        backgroundSize,
      }
    }

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

    // Reset state
    this.setState({ dimensions: null, error: false, loading: true })

    // Already loaded
    if (Image.Cache.Resolved.has(src)) {
      const cachedImg = Image.Cache.Resolved.get(src)
      if (cachedImg) {
        this.setState({
          dimensions: { height: cachedImg.naturalHeight, width: cachedImg.naturalWidth },
          loading: false,
        })
      }
      return
    }

    // Get or create loading promise
    let loadingPromise = Image.Cache.Loading.get(src)
    if (!loadingPromise) {
      loadingPromise = loadImage(src).catch(() => {
        Image.Cache.Loading.delete(src)
        return null
      }).then(img => {
        Image.Cache.Loading.delete(src)
        if (img) Image.Cache.Resolved.set(src, img)
        return img
      })
      Image.Cache.Loading.set(src, loadingPromise)
    }

    try {
      const img = await loadingPromise
      if (img) {
        this.setState({
          dimensions: { height: img.naturalHeight, width: img.naturalWidth },
          loading: false,
        })
      } else {
        this.setState({ error: true, loading: false })
      }
    } catch {
      this.setState({ error: true, loading: false })
    }
  }

  /**
   * Gets the appropriate background-size CSS value based on size prop and image dimensions.
   * @param size - The size mode for the image
   * @param dimensions - The image dimensions
   * @param dimensions.height - The image height
   * @param dimensions.width - The image width
   * @returns The CSS background-size value
   */
  private getBackgroundSize(size: Size, dimensions: { height: number, width: number }): string {
    switch (size) {
      case Size.Natural:
        return `${dimensions.width}px ${dimensions.height}px`
      case Size.Contain:
        return 'contain'
      case Size.Fill:
        return 'cover'
      default:
        return 'contain'
    }
  }

  /**
   * Gets the appropriate background-position CSS value based on align prop.
   * @param align - The alignment value for positioning
   * @returns The CSS background-position value
   */
  private getBackgroundPosition(align: Align): string {
    switch (align) {
      case Align.Center:
        return 'center'
      case Align.North:
        return 'center top'
      case Align.South:
        return 'center bottom'
      case Align.East:
        return 'right center'
      case Align.West:
        return 'left center'
      case Align.NorthEast:
        return 'right top'
      case Align.NorthWest:
        return 'left top'
      case Align.SouthEast:
        return 'right bottom'
      case Align.SouthWest:
        return 'left bottom'
      default:
        return 'center'
    }
  }

  /**
   * Returns null, because the div container handles the image display.
   * @returns null
   */
  content(): null { return null }
}
