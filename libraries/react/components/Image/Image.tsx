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
  onClick?: (event: React.MouseEvent<HTMLImageElement>) => void,
  /** Mouse down handler. */
  onMouseDown?: (event: React.MouseEvent<HTMLImageElement>) => void,
  /** Touch end handler. */
  onTouchEnd?: (event: React.TouchEvent<HTMLImageElement>) => void,
  /** Touch move handler. */
  onTouchMove?: (event: React.TouchEvent<HTMLImageElement>) => void,
  /** Touch start handler. */
  onTouchStart?: (event: React.TouchEvent<HTMLImageElement>) => void,
  /** Size value. */
  size?: Size,
  /** Source URL. */
  src: string,
}

interface State {
  /** Error state. */
  error: boolean,
}

/** A component for displaying an image. */
export class Image extends Component<Props, HTMLImageElement, State> {
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

  static defaultProps = {
    ...Component.defaultProps,
    align: Align.Center,
    size: Size.Natural,
  }

  get tag(): keyof React.JSX.IntrinsicElements { return 'img' }

  get defaultState(): State {
    return {
      error: false,
    }
  }

  get aria(): Record<string, string> {
    return {
      ...super.aria,
      'aria-description': this.props.alt || '',
    }
  }

  get attributes() {
    return {
      ...super.attributes,
      alt: this.props.alt || '',
      onClick: this.props.onClick,
      onMouseDown: this.props.onMouseDown,
      onTouchEnd: this.props.onTouchEnd,
      onTouchMove: this.props.onTouchMove,
      onTouchStart: this.props.onTouchStart,
      role: this.props.alt ? undefined : 'img',
      src: Image.Cache.Resolved.has(this.props.src)
        ? this.props.src
        : undefined,
    }
  }

  get data(): Record<string, boolean | number | string> {
    const { src } = this.props
    return {
      ...super.data,
      align: this.props.align,
      error: this.state.error,
      loaded: Image.Cache.Resolved.has(src),
      loading: Image.Cache.Loading.has(src),
      size: this.props.size,
    }
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

    // Already loaded
    if (Image.Cache.Resolved.has(src)) {
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

    if (await loadingPromise) {
      this.forceUpdate()
    } else {
      await this.setState({ error: true })
    }
  }

  /**
   * Returns null, because `<img>` elements do not have content.
   * @returns null
   */
  content(): null { return null }
}
