import * as React from 'react'
import { match } from '@basis/utilities/functions/match'
import { noop } from '@basis/utilities/functions/noop'
import { Align } from '../../types/Align'
import type { ImageConfig } from '../../types/ImageConfig'
import type { ImageInput } from '../../types/ImageInput'
import { Size } from '../../types/Size'
import { loadImage } from '../../utilities/loadImage'
import { Component } from '../Component/Component'
import { Image } from '../Image/Image'
import './Carousel.scss'

/**
 * Props for the Carousel component
 */
interface Props {
  /** Default alignment for all images */
  align?: Align,
  /** Default alt text for images that don't specify their own */
  altText?: string,
  /** Children should be img elements */
  children?: React.ReactNode,
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
    onImageChange: noop,
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
    return typeof input === 'string'
      ? { altText: this.props.altText, url: input }
      : { ...input, altText: input.altText || this.props.altText }
  }

  get images(): ImageConfig[] {
    const { children, images = [] } = this.props
    const childImages = React.Children.toArray(children)
      .filter((child): child is React.ReactElement => (
        React.isValidElement(child)
        && (child.type === 'img' || child.type === Image)
      ))
      .map<ImageConfig>(element => {
        const { props } = element
        const url = props.src
        const altText = props.alt || props.altText || this.props.altText

        let align = props['data-align']
        let size = props['data-size']

        if (element.type === Image) {
          align = props.align
          size = props.size
        }

        align = match(align)
          .when(v => Object.values(Align).includes(v as Align)).then(v => v as Align)
          .when(v => Object.keys(Align).includes(v)).then(v => Align[v as keyof typeof Align])
          .else(undefined)

        size = match(size)
          .when(v => Object.values(Size).includes(v as Size)).then(v => v as Size)
          .when(v => Object.keys(Size).includes(v)).then(v => Size[v as keyof typeof Size])
          .else(undefined)

        return { align, altText, size, url }
      })

    return [
      ...images.map(image => (
        typeof image === 'string'
          ? { altText: this.props.altText, url: image }
          : image
      )),
      ...childImages,
    ]
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
    }
  }

  public handleTouchStart = (e: React.TouchEvent) => {
    this.setState({ touchStart: e.touches[0].clientX })
  }

  public handleTouchMove = (e: React.TouchEvent) => {
    if (this.state.touchStart === null) return

    const diff = this.state.touchStart - e.touches[0].clientX
    if (Math.abs(diff) > 50) {
      if (diff > 0) this.next()
      else this.prev()
      this.setState({ touchStart: null })
    }
  }

  public handleTouchEnd = () => {
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

  componentDidMount() {
    this.rootNode?.addEventListener('wheel', this.handleWheel, { passive: false })
    // Preload all images
    this.preloadImages()
  }

  componentWillUnmount() {
    this.rootNode?.removeEventListener('wheel', this.handleWheel)
  }

  private handleWheel = (event: WheelEvent) => {
    event.preventDefault()

    if (event.deltaX > 0 || event.deltaY > 0) {
      this.next()
    } else if (event.deltaX < 0 || event.deltaY < 0) {
      this.prev()
    }
  }

  private preloadImages = () => {
    // Get all unique image URLs
    const urls = new Set(this.images.map(img => img.url))

    // Start loading any images that aren't already loaded/loading
    urls.forEach(url => {
      if (!Image.Cache.Resolved.has(url) && !Image.Cache.Loading.has(url)) {
        const loadingPromise = loadImage(url).then(img => {
          Image.Cache.Loading.delete(url)
          Image.Cache.Resolved.set(url, img)
          return img
        }).catch(error => {
          Image.Cache.Loading.delete(url)
          throw error
        })
        Image.Cache.Loading.set(url, loadingPromise)
      }
    })
  }

  content() {
    const { currentIndex, fullSize: isFullSize, lightbox: isLightboxOpen } = this.state
    const { currentImage } = this
    if (!currentImage) return null

    const totalImages = this.images.length
    const imageNumber = currentIndex + 1
    const imageDescription = `Image ${imageNumber} of ${totalImages}`

    // Use currentImage.altText if available, fall back to props.altText
    const altText = currentImage.altText || this.props.altText || ''

    return (
      <>
        <Image
          align={currentImage.align}
          alt={altText}
          aria-current="true"
          aria-description={imageDescription}
          aria-roledescription="slide"
          size={currentImage.size}
          src={currentImage.url}
          onClick={this.handleImageClick}
          onTouchEnd={this.handleTouchEnd}
          onTouchMove={this.handleTouchMove}
          onTouchStart={this.handleTouchStart}
        />
        {isLightboxOpen && (
          <div
            aria-label="Image lightbox"
            aria-modal="true"
            className="lightbox-overlay"
            data-full-size={isFullSize}
            role="dialog"
            onClick={this.handleLightboxClick}
          >
            <Image
              key={currentImage.url}
              align={currentImage.align}
              alt={altText}
              aria-description={imageDescription}
              size={currentImage.size}
              src={currentImage.url}
              onClick={this.handleImageClick}
              onTouchEnd={this.handleTouchEnd}
              onTouchMove={this.handleTouchMove}
              onTouchStart={this.handleTouchStart}
            />
            {altText && (
              <div className="lightbox-caption">
                {altText}
              </div>
            )}
            <div aria-label="Image navigation" className="navigation">
              <div
                aria-label="Previous image"
                className="prev"
                role="button"
                onClick={this.prev}
              />
              <div
                aria-label="Next image"
                className="next"
                role="button"
                onClick={this.next}
              />
            </div>
            <div aria-hidden="true" className="indicators">
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
