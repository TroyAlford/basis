import type { ComponentType } from 'react'
import * as React from 'react'
import { classNames, deepEquals, kebabCase, noop } from '../../../utilities'
import type { Mixin } from '../../types/Mixin'
import { filterByPrefix } from '../../utilities/filterByPrefix'
import { prefixObject } from '../../utilities/prefixObject'

type Tag<P = object> =
  | keyof React.JSX.IntrinsicElements
  | ComponentType<P>

/** Props for the Component class. */
interface TProps<E extends Element = HTMLDivElement> {
  /** The children of the component. */
  children?: React.ReactNode,
  /** Optional class name(s) to output on the component's root element. */
  className?:
  | string
  | Set<string>
  | Record<string, boolean | (() => boolean)>,
  /** An optional ref to the component's root element. */
  nodeRef?: React.RefObject<E>,
  /** Callback function called when a key is pressed while the component has focus. */
  onKeyDown?: (event: React.KeyboardEvent<HTMLElement>) => void,
  /** The style of the component. */
  style?: React.CSSProperties,
  /** The name of the theme to use for the component. */
  theme?: string,
}

/** Native element attributes appropriate to a component's root element. */
type NativeAttributes<E extends Element> =
  E extends SVGElement ? React.SVGAttributes<E> : React.HTMLAttributes<E>

/**
 * Native DOM event names Basis components own as component props and therefore
 * must not have forwarded to the root element by the base class.
 */
type ReservedNativeKeys = 'onChange' | 'onKeyDown' | 'onSelect'

/**
 * Native attribute names Basis components own as component props (for example
 * `Theme`'s `color` palette, a `Notification`'s React-node `title`, or a
 * `Shape`'s `fill`/`stroke`), so the base class must not forward them to the
 * root element.
 */
type OwnedNativeKeys = 'color' | 'content' | 'fill' | 'prefix' | 'stroke' | 'title'

/** The native element surface, minus props the base or the component owns. */
type NativeProps<E extends Element> = Omit<
  NativeAttributes<E>,
  keyof TProps<E> | ReservedNativeKeys | OwnedNativeKeys
>

type P<E extends Element, T> = TProps<E> & T & NativeProps<E>

/**
 * Standard native attributes and event handlers the base `Component` forwards
 * to its root element. Only names in this set are considered, so
 * component-specific props are never spread onto the DOM.
 */
const NATIVE_ATTRIBUTES: ReadonlySet<string> = new Set([
  // Global attributes
  'accessKey', 'autoCapitalize', 'autoCorrect', 'contentEditable', 'dir', 'draggable',
  'enterKeyHint', 'hidden', 'id', 'inputMode', 'lang', 'nonce', 'part', 'popover',
  'role', 'slot', 'spellCheck', 'tabIndex', 'title', 'translate',
  // Event handlers
  'onAnimationEnd', 'onAnimationIteration', 'onAnimationStart', 'onAuxClick', 'onBlur',
  'onClick', 'onCompositionEnd', 'onCompositionStart', 'onCompositionUpdate',
  'onContextMenu', 'onCopy', 'onCut', 'onDoubleClick', 'onDrag', 'onDragEnd',
  'onDragEnter', 'onDragExit', 'onDragLeave', 'onDragOver', 'onDragStart', 'onDrop',
  'onFocus', 'onGotPointerCapture', 'onInput', 'onInvalid', 'onKeyPress', 'onKeyUp',
  'onLostPointerCapture', 'onMouseDown', 'onMouseEnter', 'onMouseLeave', 'onMouseMove',
  'onMouseOut', 'onMouseOver', 'onMouseUp', 'onPaste', 'onPointerCancel', 'onPointerDown',
  'onPointerEnter', 'onPointerLeave', 'onPointerMove', 'onPointerOut', 'onPointerOver',
  'onPointerUp', 'onReset', 'onScroll', 'onSubmit', 'onTouchCancel', 'onTouchEnd',
  'onTouchMove', 'onTouchStart', 'onTransitionEnd', 'onWheel',
  // Common SVG presentation attributes
  'clipPath', 'clipRule', 'cx', 'cy', 'd', 'dominantBaseline', 'fill', 'fillOpacity',
  'fillRule', 'filter', 'fontFamily', 'fontSize', 'fontStyle', 'fontWeight', 'height',
  'letterSpacing', 'markerEnd', 'markerMid', 'markerStart', 'mask', 'offset', 'opacity',
  'paintOrder', 'points', 'preserveAspectRatio', 'r', 'rx', 'ry', 'stopColor', 'stopOpacity',
  'stroke', 'strokeDasharray', 'strokeDashoffset', 'strokeLinecap', 'strokeLinejoin',
  'strokeMiterlimit', 'strokeOpacity', 'strokeWidth', 'textAnchor', 'transform',
  'vectorEffect', 'viewBox', 'width', 'x', 'x1', 'x2', 'xmlns', 'xmlnsXlink', 'y', 'y1', 'y2',
])

/** Native event names Basis components own as component props. */
const RESERVED_NATIVE_KEYS: ReadonlySet<string> = new Set<ReservedNativeKeys>([
  'onChange', 'onKeyDown', 'onSelect',
])

/** Native attribute names Basis components own as component props. */
const OWNED_NATIVE_KEYS: ReadonlySet<string> = new Set<OwnedNativeKeys>([
  'color', 'content', 'fill', 'prefix', 'stroke', 'title',
])

/**
 * Filter component props down to the native attributes the base class forwards.
 * @param props - The component props.
 * @param owned - Native prop names the component or a mixin already owns.
 * @returns The native attributes to emit on the root element.
 */
const nativeAttributes = (props: object, owned: ReadonlySet<string>): Record<string, unknown> => {
  const attributes: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue
    if (!NATIVE_ATTRIBUTES.has(key)) continue
    if (owned.has(key) || RESERVED_NATIVE_KEYS.has(key) || OWNED_NATIVE_KEYS.has(key)) continue
    attributes[key] = value
  }
  return attributes
}

/**
 * The abstract base class for all components in the `@basis/react` package.
 * @template Props The props of the component.
 * @template Element The root element type of the component.
 * @template State The state of the component.
 */
export abstract class Component<
  /** The props of the component. */
  Props = object,
  /** The root element type of the component. */
  Element extends HTMLElement | SVGElement = HTMLDivElement,
  /** The state of the component. */
  State = object,
> extends React.Component<P<Element, Props>, State> {
  static get mixins(): Set<Mixin> { return new Set() }
  static get defaultProps(): Partial<TProps> {
    return {
      onKeyDown: () => undefined,
      theme: undefined,
      ...Array.from(this.mixins).reduce((props, mixin) => ({
        ...props, ...mixin.defaultProps,
      }), {}),
    }
  }

  /**
   * Native prop names the component or its mixins already own, and so must not
   * be forwarded to the root element by the base class.
   * @returns The owned native prop names.
   */
  get ownedNativeProps(): ReadonlySet<string> {
    const { defaultProps } = this.constructor as typeof Component
    return new Set(Object.keys(defaultProps ?? {}))
  }

  /**
   * Getter for attributes.
   * @returns a React.HTMLAttributes<Element> object
   * @example get attributes() { return { tabIndex: 0 } }
   */
  get attributes() {
    return {
      'data-theme': this.props.theme,
      'style': this.props.style,
      ...nativeAttributes(this.props, this.ownedNativeProps),
      ...prefixObject('aria-', filterByPrefix('aria-', this.props)),
      ...prefixObject('data-', filterByPrefix('data-', this.props)),
      ...this.mixins.reduce((attributes, mixin) => ({
        ...attributes, ...mixin.attributes?.(this.props),
      }), {}),
    }
  }

  /**
   * Getter for class names.
   * @returns a Set<string> of class names. Component automatically adds a kebab-cased version of the
   * component's name (using `displayName` or `name`) to the set.
   */
  get classNames(): Set<string> {
    return new Set<string>()
      // @ts-expect-error - displayName is valid in React components, but not typed
      .add(kebabCase(this.constructor.displayName ?? this.constructor.name))
      .add('component')
  }

  /**
   * Getter for the initial state of the component.
   * @returns The initial state of the component.
   */
  get defaultState(): State { return {} as State }
  readonly state = this.defaultState

  #nodeRef = React.createRef<Element>()
  get nodeRef(): React.RefObject<Element> {
    return this.props.nodeRef ?? this.#nodeRef
  }

  /**
   * Getter for the root element of the component.
   * @returns The root element of the component.
   */
  get rootNode(): Element | null {
    return this.nodeRef.current
  }

  /**
   * The tag name of the component's root node.
   * @returns The tag name.
   */
  get tag(): Tag<Props> { return 'div' }

  /**
   * Determines if the component should update.
   * @param nextProps The next props.
   * @param nextState The next state.
   * @returns Whether the component should update.
   */
  shouldComponentUpdate(nextProps: Readonly<Props & TProps<Element>>, nextState: Readonly<State>): boolean {
    return !deepEquals(this.props, nextProps) || !deepEquals(this.state, nextState)
  }

  /** Called after component mounts. */
  componentDidMount(): void {
    this.applyMixins('componentDidMount')
  }

  /**
   * Called after component updates.
   * @param prevProps The previous props.
   * @param prevState The previous state.
   */
  componentDidUpdate(prevProps: Readonly<Props & TProps<Element>>, prevState: Readonly<State>): void {
    this.applyMixins('componentDidUpdate', prevProps, prevState)
  }

  /** Called before component unmounts. */
  componentWillUnmount(): void {
    this.applyMixins('componentWillUnmount')
  }

  get mixins(): Mixin<Props>[] {
    return Array.from((this.constructor as typeof Component).mixins)
      // ensure post mixins are applied last
      .sort((a, b) => (a.post && !b.post ? 1 : -1))
  }

  /**
   * Renders the component's content. Called once per render.
   * @param children The children of the component.
   * @returns The rendered content.
   */
  content(children?: React.ReactNode): React.ReactNode {
    if (!React.isValidElement(children)) return children
    return this.mixins.reduce((content, mixin) => (
      mixin.content?.(content, this) ?? content
    ), children)
  }

  /**
   * Renders the component.
   * @returns The rendered React node.
   */
  render(): React.ReactNode {
    const Tag = this.tag
    const { children, className, nodeRef } = this.props

    const rendered = ( // @ts-expect-error - we are assuming a props match
      <Tag // @ts-expect-error - we are assuming a props match
        ref={nodeRef ?? this.nodeRef}
        {...this.attributes}
        className={classNames(className, this.classNames)}
      >
        {this.content(children)}
      </Tag>
    )

    return this.mixins.reduce((element, mixin) => (
      typeof mixin.render === 'function'
        ? mixin.render(element, this)
        : element
    ), rendered)
  }

  /**
   * Handles keyboard events with basic onKeyDown functionality.
   * @param event The keyboard event.
   */
  protected handleKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
    this.props.onKeyDown(event)
  }

  /**
   * Sets the state of the component.
   * @param state A partial state update or updater function. Partial state updates are shallow-merged.
   * @param callback Callback to receive updated state after update/re-render is complete.
   * @returns Promise<State> that resolves after update/re-render is complete.
   */
  // @ts-expect-error - Intentionally improving the base-class's type signature.
  override async setState(
    // Note: @types/react says `State`, but `Partial<State>` is correct.
    state: Partial<State> | ((current: State) => Partial<State>),
    callback: ((state: State) => void) = noop,
  ): Promise<State> {
    await new Promise<void>(resolve => (
      super.setState(state as State, () => {
        callback(this.state)
        resolve()
      })
    ))
    return this.state
  }

  private applyMixins(event: keyof Mixin<Props>, ...args: unknown[]): void {
    const mixins = (this.constructor as typeof Component).mixins
    if (!mixins.size) return

    // For other lifecycle methods, just call them
    Array.from(mixins).forEach(mixin => {
      const method = mixin[event] as (component: typeof this, ...args: unknown[]) => void
      method?.(this, ...args)
    })
  }
}
