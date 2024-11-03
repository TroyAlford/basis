import type * as React from 'react'
import { Align } from '../../types/Align'
import { Size } from '../../types/Size'
import { loadImage } from '../../utilities/loadImage'
import { Component } from '../Component/Component'
import './Image.scss'

interface Props {
  align?: Align,
  alt?: string,
  onClick?: (event: React.MouseEvent<HTMLImageElement>) => void,
  onTouchEnd?: (event: React.TouchEvent<HTMLImageElement>) => void,
  onTouchMove?: (event: React.TouchEvent<HTMLImageElement>) => void,
  onTouchStart?: (event: React.TouchEvent<HTMLImageElement>) => void,
  size?: Size,
  src: string,
}

interface State {
  error: boolean,
}

export class Image extends Component<Props, HTMLImageElement, State> {
  static Align = Align
  static Size = Size
  static Cache = {
    Loading: new Map<string, Promise<HTMLImageElement>>(),
    Resolved: new Map<string, HTMLImageElement>(),
  }

  static defaultProps = {
    ...Component.defaultProps,
    align: Align.Center,
    size: Size.Natural,
  }

  readonly tag = 'img' as const

  get defaultState(): State {
    return {
      error: false,
    }
  }

  get attributes(): React.ImgHTMLAttributes<HTMLImageElement> {
    return {
      alt: this.props.alt || '',
      onClick: this.props.onClick,
      onTouchEnd: this.props.onTouchEnd,
      onTouchMove: this.props.onTouchMove,
      onTouchStart: this.props.onTouchStart,
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

  componentDidMount() {
    this.loadImage()
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.src !== this.props.src) {
      this.loadImage()
    }
  }

  private loadImage = async () => {
    const { src } = this.props

    // Already loaded
    if (Image.Cache.Resolved.has(src)) {
      return
    }

    // Get or create loading promise
    let loadingPromise = Image.Cache.Loading.get(src)
    if (!loadingPromise) {
      loadingPromise = loadImage(src).then(img => {
        Image.Cache.Loading.delete(src)
        Image.Cache.Resolved.set(src, img)
        return img
      }).catch(error => {
        Image.Cache.Loading.delete(src)
        throw error
      })
      Image.Cache.Loading.set(src, loadingPromise)
    }

    // Add our own .then() to handle this instance's update
    try {
      await loadingPromise
      this.forceUpdate()
    } catch {
      this.setState({ error: true })
    }
  }

  content(): null { return null }
}
