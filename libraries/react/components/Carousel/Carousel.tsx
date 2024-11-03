import * as React from 'react'
import { match } from '@basis/utilities/functions/match'
import { Component } from '../Component/Component'
import './Carousel.scss'

/**
 * Determines how images should be sized within the carousel container
 */
enum Size {
  /** Maintain aspect ratio and fit entirely within container */
  Contain = 'contain',
  /** Cover entire container, cropping if necessary */
  Fill = 'fill',
}

/**
 * Determines how images should be aligned within the carousel container
 */
enum Align {
  /** Center both horizontally and vertically */
  Center = 'center',
  /** Align to right edge */
  East = 'e',
  /** Align to top edge */
  North = 'n',
  /** Align to top-right corner */
  NorthEast = 'ne',
  /** Align to top-left corner */
  NorthWest = 'nw',
  /** Align to bottom edge */
  South = 's',
  /** Align to bottom-right corner */
  SouthEast = 'se',
  /** Align to bottom-left corner */
  SouthWest = 'sw',
  /** Align to left edge */
  West = 'w',
}

/**
 * Configuration object for a single carousel image
 */
interface ImageConfig {
  /** Optional alignment override for this specific image */
  align?: Align,
  /** Optional size override for this specific image */
  size?: Size,
  /** URL of the image to display */
  url: string,
}

/**
 * Acceptable image input types - either a URL string or an ImageConfig object
 */
type ImageInput = string | ImageConfig

/**
 * Props for the Carousel component
 */
interface Props {
  /** Default alignment for all images */
  align?: Align,
  /** Array of image URLs or image configs */
  images?: ImageInput[],
  /** Optional callback when image changes */
  onImageChange?: (index: number) => void,
  /** Default size for all images */
  size?: Size,
}

/**
 * State for the Carousel component
 */
interface State {
  /** Index of the currently displayed image */
  currentIndex: number,
  /** Whether the lightbox is open */
  fullSize: boolean,
  /** Whether the lightbox is open */
  lightbox: boolean,
  /** X-coordinate of the touch start */
  touchStart: number | null,
}

/**
 * A responsive image carousel component with lightbox functionality
 * @example
 * // Basic usage with image URLs
 * <Carousel
 *   images={[
 *     'https://example.com/image1.jpg',
 *     'https://example.com/image2.jpg'
 *   ]}
 * />
 * @example
 * // Advanced usage with image configs
 * <Carousel
 *   size={Carousel.Size.Contain}
 *   align={Carousel.Align.Center}
 *   images={[
 *     {
 *       url: 'https://example.com/image1.jpg',
 *       align: Carousel.Align.NorthWest,
 *       size: Carousel.Size.Fill
 *     },
 *     'https://example.com/image2.jpg'
 *   ]}
 *   onImageChange={(index) => console.log(`Switched to image ${index}`)}
 * />
 */
export class Carousel extends Component<Props, HTMLDivElement, State> {
  static Align = Align
  static Size = Size

  static defaultProps = {
    ...Component.defaultProps,
    align: Align.Center,
    images: [],
    size: Size.Contain,
  }

  get data(): Record<string, boolean | number | string> {
    return {
      ...super.data,
      'align': this.currentImage?.align ?? this.props.align,
      'full-size': this.state.fullSize,
      'lightbox': this.state.lightbox,
      'size': this.currentImage?.size ?? this.props.size,
    }
  }

  get defaultState(): State {
    return {
      currentIndex: 0,
      fullSize: false,
      lightbox: false,
      touchStart: null,
    }
  }

  get currentImage(): ImageConfig | null {
    const input = this.images[this.state.currentIndex]
    if (!input) return null
    return typeof input === 'string' ? { url: input } : input
  }

  get images(): ImageInput[] {
    const { children, images } = this.props
    if (images?.length) return images

    return React.Children.toArray(children)
      .filter(child => typeof child === 'string')
      .map(url => url as string)
  }

  get attributes(): React.HTMLAttributes<HTMLDivElement> {
    return {
      ...super.attributes,
      onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (!this.state.lightbox) return
        match(e.key)
          .when('ArrowLeft').then(this.prev)
          .when('ArrowRight').then(this.next)
          .when('Escape').then(this.closeLightbox)
      },
      onWheel: (e: React.WheelEvent<HTMLDivElement>) => {
        e.preventDefault()
        if (e.deltaY > 0) this.next()
        else if (e.deltaY < 0) this.prev()
      },
    }
  }

  private handleTouchStart = (e: React.TouchEvent) => {
    this.setState({ touchStart: e.touches[0].clientX })
  }

  private handleTouchMove = (e: React.TouchEvent) => {
    if (this.state.touchStart === null) return

    const diff = this.state.touchStart - e.touches[0].clientX
    if (Math.abs(diff) > 50) {
      if (diff > 0) this.next()
      else this.prev()
      this.setState({ touchStart: null })
    }
  }

  private handleTouchEnd = () => {
    this.setState({ touchStart: null })
  }

  private handleImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    const { lightbox: isLightboxOpen } = this.state

    if (!isLightboxOpen) {
      this.setState({ lightbox: true })
      return
    }

    const rect = e.currentTarget.getBoundingClientRect()
    const clickX = e.clientX - rect.left

    if (clickX < rect.width * 0.3) this.prev()
    else if (clickX > rect.width * 0.7) this.next()
    else this.setState(state => ({ fullSize: !state.fullSize }))
  }

  public next = () => {
    this.setState(state => ({
      currentIndex: (state.currentIndex + 1) % this.images.length,
    }), () => this.props.onImageChange?.(this.state.currentIndex))
  }

  public prev = () => {
    this.setState(state => ({
      currentIndex: (state.currentIndex - 1 + this.images.length) % this.images.length,
    }), () => this.props.onImageChange?.(this.state.currentIndex))
  }

  public closeLightbox = () => {
    this.setState({ fullSize: false, lightbox: false })
  }

  private handleLightboxClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      this.closeLightbox()
    }
  }

  content() {
    const { currentIndex, fullSize: isFullSize, lightbox: isLightboxOpen } = this.state
    const { currentImage } = this
    if (!currentImage) return null

    return (
      <>
        <img
          alt=""
          src={currentImage.url}
          onClick={this.handleImageClick}
          onTouchEnd={this.handleTouchEnd}
          onTouchMove={this.handleTouchMove}
          onTouchStart={this.handleTouchStart}
        />
        {isLightboxOpen && (
          <div
            className="lightbox-overlay"
            data-full-size={isFullSize}
            onClick={this.handleLightboxClick}
          >
            <img
              alt=""
              src={currentImage.url}
              onClick={this.handleImageClick}
              onTouchEnd={this.handleTouchEnd}
              onTouchMove={this.handleTouchMove}
              onTouchStart={this.handleTouchStart}
            />
            <div className="navigation">
              <div className="prev" onClick={this.prev} />
              <div className="next" onClick={this.next} />
            </div>
            <div className="indicators">
              {this.images.map((_, i) => (
                <div
                  key={i}
                  className="dot"
                  data-active={i === currentIndex}
                />
              ))}
            </div>
          </div>
        )}
      </>
    )
  }
}
