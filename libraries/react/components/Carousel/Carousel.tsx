import * as React from 'react'
import { createPortal } from 'react-dom'
import { match, noop } from '@basis/utilities'
import { Align } from '../../types/Align'
import type { ImageConfig } from '../../types/ImageConfig'
import type { ImageInput } from '../../types/ImageInput'
import { Size } from '../../types/Size'
import { loadImage } from '../../utilities/loadImage'
import { Button } from '../Button/Button'
import { Component } from '../Component/Component'
import { Image } from '../Image/Image'
import './Carousel.scss'

interface Props {
  /** Default alignment for all images. */
  align?: Align,
  /** Default alt text for images that don't specify their own. */
  altText?: string,
  /** Children should be img or Image elements. */
  children?: React.ReactNode,
  /** Array of image URLs or image configs. */
  images?: ImageInput[],
  /** Optional callback when the image changes. */
  onImageChange?: (index: number) => void,
  /** Default size for all images. */
  size?: Size,
}

interface State {
  /** Index of the currently displayed image. */
  currentIndex: number,
  /** Whether the lightbox is open. */
  lightbox: boolean,
}

/**
 * A responsive image carousel component with lightbox functionality.
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
    descriptionId: undefined,
    images: [],
    onImageChange: noop,
    size: Size.Contain,
  }

  touchStart: number | null = null

  get aria(): Record<string, string> {
    return {
      'aria-roledescription': 'carousel',
      'label': 'Image Carousel',
      'live': 'polite',
    }
  }

  get attributes() {
    return {
      ...super.attributes,
      onKeyDown: this.handleKeyDown,
      onWheel: this.handleWheel,
      role: 'region',
      tabIndex: -1, // Make focusable but not tabbable
    }
  }

  /**
   * Returns the currently displayed image configuration or null if no image is available
   * @returns The currently displayed image configuration or null.
   */
  get currentImage(): ImageConfig | null {
    const input = this.images[this.state.currentIndex]
    if (!input) return null
    return typeof input === 'string'
      ? { altText: this.props.altText, url: input }
      : { ...input, altText: input.altText || this.props.altText }
  }

  get data(): Record<string, boolean | number | string> {
    return {
      ...super.data,
      align: this.currentImage?.align ?? this.props.align,
      lightbox: this.state.lightbox,
      size: this.currentImage?.size ?? this.props.size,
    }
  }

  get defaultState(): State {
    return {
      currentIndex: 0,
      lightbox: false,
    }
  }

  /**
   * Returns the array of normalized image configurations from both props and children
   * @returns The array of image configurations.
   */
  get images(): ImageConfig[] {
    const { children, images = [] } = this.props
    const childImages = React.Children.toArray(children)
      .filter((child): child is React.ReactElement<Image['props'] & { altText?: string }> => (
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

  componentDidMount(): void {
    this.preloadImages()
  }

  componentDidUpdate(_: Props, prevState: State): void {
    if (prevState.lightbox !== this.state.lightbox) {
      if (this.state.lightbox) {
        document.addEventListener('keydown', this.handleGlobalKeyDown)
        document.addEventListener('wheel', this.handleWheel, { passive: false })
      } else {
        document.removeEventListener('keydown', this.handleGlobalKeyDown)
        document.removeEventListener('wheel', this.handleWheel)
      }
    }
  }

  componentWillUnmount(): void {
    if (this.state.lightbox) {
      document.removeEventListener('keydown', this.handleGlobalKeyDown)
      document.removeEventListener('wheel', this.handleWheel)
    }
  }

  /** Closes the lightbox and returns focus to the carousel */
  closeLightbox = (): void => {
    this.setState({ lightbox: false }, () => {
      this.rootNode?.focus()
    })
  }

  /**
   * Handles global keyboard events when lightbox is open
   * @param event - The keyboard event.
   */
  handleGlobalKeyDown = (event: KeyboardEvent): void => {
    if (!this.state.lightbox) return

    if (event.key === 'Escape') {
      this.closeLightbox()
    }
  }

  /**
   * Handles image click events for opening lightbox and navigation
   * @param event - The mouse event.
   */
  handleImageClick = (event: React.MouseEvent<HTMLImageElement>): void => {
    if (event.button !== 0) return

    if (!this.state.lightbox) {
      this.setState({ lightbox: true })
      return
    }

    this.next()
  }

  /**
   * Handles middle-click to open image in new tab
   * @param event - The mouse event.
   */
  handleImageMouseDown = (event: React.MouseEvent<HTMLImageElement>): void => {
    if (event.button !== 1) return
    window.open(this.currentImage?.url, '_blank')
  }

  /**
   * Handles keyboard navigation when carousel has focus
   * @param event - The keyboard event.
   */
  handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    switch (event.key) {
      case 'ArrowRight':
        this.next()
        break
      case 'ArrowLeft':
        this.prev()
        break
    }
  }

  /**
   * Handles clicks on the lightbox background to close it
   * @param event - The mouse event.
   */
  handleLightboxClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) {
      this.closeLightbox()
    }
  }

  /** Resets touch tracking state */
  handleTouchEnd = (): void => {
    this.touchStart = null
  }

  /**
   * Handles touch move events for swipe navigation
   * @param event - The touch event.
   */
  handleTouchMove = (event: React.TouchEvent): void => {
    if (this.touchStart === null) return

    const diff = this.touchStart - event.touches[0].clientX
    if (Math.abs(diff) > 50) {
      if (diff > 0) this.next()
      else this.prev()
      this.touchStart = null
    }
  }

  /**
   * Tracks touch start position for swipe navigation
   * @param event - The touch event.
   */
  handleTouchStart = (event: React.TouchEvent): void => {
    this.touchStart = event.touches[0].clientX
  }

  /**
   * Handles mouse wheel events for navigation
   * @param event - The wheel event.
   */
  handleWheel = (event: WheelEvent | React.WheelEvent<HTMLDivElement>): void => {
    event.preventDefault()

    if (event.deltaX > 0 || event.deltaY > 0) {
      this.next()
    } else if (event.deltaX < 0 || event.deltaY < 0) {
      this.prev()
    }
  }

  /** Advances to the next image */
  next = (): void => {
    this.setState(state => ({
      currentIndex: (state.currentIndex + 1) % this.images.length,
    }), () => this.props.onImageChange?.(this.state.currentIndex))
  }

  /** Preloads all images in the carousel */
  preloadImages = (): void => {
    const urls = new Set(this.images.map(img => img.url))

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

  /** Returns to the previous image */
  prev = (): void => {
    this.setState(state => ({
      currentIndex: (state.currentIndex - 1 + this.images.length) % this.images.length,
    }), () => this.props.onImageChange?.(this.state.currentIndex))
  }

  content(): React.ReactNode {
    const { currentIndex, lightbox: isLightboxOpen } = this.state
    const { currentImage } = this
    if (!currentImage) return null

    const altText = currentImage.altText || this.props.altText || ''

    const lightboxContent = isLightboxOpen && (
      <div
        {...this.attributes}
        aria-label="Image lightbox"
        aria-modal="true"
        className="carousel component lightbox"
        role="dialog"
        tabIndex={-1}
        onClick={this.handleLightboxClick}
      >
        <Button
          aria-label="Close lightbox"
          className="close-button"
          onActivate={this.closeLightbox}
        >
          ×
        </Button>
        <div className="image-container">
          <Image
            key={currentImage.url}
            align={currentImage.align}
            alt={altText}
            size={currentImage.size}
            src={currentImage.url}
            onClick={this.handleImageClick}
            onTouchEnd={this.handleTouchEnd}
            onTouchMove={this.handleTouchMove}
            onTouchStart={this.handleTouchStart}
          />
        </div>
        {this.renderNavigation(currentIndex)}
        {altText && (
          <div className="lightbox-caption">
            {altText}
          </div>
        )}
      </div>
    )

    return (
      <>
        <Image
          align={currentImage.align}
          alt={altText}
          aria-current="true"
          aria-description={altText}
          aria-roledescription="slide"
          size={currentImage.size}
          src={currentImage.url}
          onClick={this.handleImageClick}
          onMouseDown={this.handleImageMouseDown}
          onTouchEnd={this.handleTouchEnd}
          onTouchMove={this.handleTouchMove}
          onTouchStart={this.handleTouchStart}
        />
        {this.renderNavigation(currentIndex)}
        {isLightboxOpen && createPortal(lightboxContent, document.body)}
      </>
    )
  }

  /**
   * Renders the navigation controls
   * @param currentIndex - The index of the current image.
   * @returns The navigation controls.
   */
  renderNavigation(currentIndex: number): React.ReactNode {
    const totalImages = this.images.length
    return (
      <div
        aria-label="Image Navigation"
        className="navigation"
        role="group"
      >
        <Button
          aria-label={`Previous image (${currentIndex} of ${totalImages})`}
          className="prev"
          onActivate={this.prev}
        >
          ←
        </Button>
        <div aria-hidden="true" className="counter">
          {`${currentIndex + 1} of ${totalImages}`}
        </div>
        <Button
          aria-label={`Next image (${currentIndex + 2} of ${totalImages})`}
          className="next"
          onActivate={this.next}
        >
          →
        </Button>
      </div>
    )
  }
}
