import type { PathOf, TypeAt } from '../../../utilities'
import { clone, deepEquals, isNil, noop, set } from '../../../utilities'
import { Component } from '../Component/Component'

export interface EditorProps<Value> {
  /** Field identifier (number or string) */
  field?: string,
  /** Initial value for uncontrolled mode */
  initialValue?: Value,
  /** Change handler */
  onChange?: (
    /** The new value */
    value: Value,
    /** The field identifier */
    field: string,
    /**
     * The editor instance. Typed as `unknown` to avoid circular TS dependencies.
     * @example
     * ```ts
     * // ---------------------------------- ↘ cast the type ↘
     * function onChange(value, field, editor as Editor<Value>) {}
     * // ---------------------------------- ↗ cast the type ↗
     * ```
     */
    editor: unknown,
  ) => void,
  /** Whether the editor is read-only */
  readOnly?: boolean,
  /** Current value for controlled mode */
  value?: Value,
}

interface TState<Value> {
  /** Current value in uncontrolled mode */
  current: Value,
}

type P<V, T> = EditorProps<V> & T
type S<V, T> = TState<V> & T

/**
 * Type-only brand identifying concrete editor classes without expanding the editor's generics.
 * It gives constructor constraints an editor-specific identity that stays cheap to instantiate.
 */
export declare const editorClassBrand: unique symbol

/**
 * Abstract base class for editor components.
 * Extends Component to provide common editor functionality.
 */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - TS2589: Type instantiation is excessively deep and possibly infinite.
export abstract class Editor<
  Value,
  Element extends HTMLElement = HTMLElement,
  Props = EditorProps<Value>,
  State = TState<Value>,
> extends Component<P<Value, Props>, Element, S<Value, State>> {
  /** Type-only editor identity for constructor constraints. */
  declare readonly [editorClassBrand]: true

  static defaultProps: Partial<EditorProps<unknown> & Component['props']> = {
    ...super.defaultProps,
    onChange: noop,
    readOnly: false,
  }

  /** `onChange` is the Basis editor value contract, not a native root event. */
  static ownedNativeProps = ['onChange']

  /**
   * Checks if a constructor is an Editor
   * @param ctor - The constructor to check
   * @returns Whether the constructor is an Editor
   */
  static isEditor(ctor: unknown): ctor is new (...args: unknown[]) => Editor<unknown> {
    if (ctor === Editor) return true
    if (ctor instanceof Editor) return true
    return typeof ctor === 'function' && ctor.prototype instanceof Editor
  }

  /**
   * Complete a shallow partial initial value into this editor's full value.
   *
   * The base contract passes the supplied value through unchanged: Basis never invents
   * missing fields. Editors whose value has required fields and that accept partial initial
   * values must override this with their explicit, tested defaulting rules (or throw to
   * reject incomplete input).
   * @param initialValue - Shallow partial initial value.
   * @returns The value to use as the editor baseline.
   */
  static initialize(initialValue: Partial<unknown>): unknown {
    return initialValue
  }

  get defaultState(): S<Value, State> {
    return {
      ...super.defaultState,
      current: this.props.value ?? this.props.initialValue,
    }
  }

  get attributes(): (typeof this)['attributes'] {
    return {
      ...super.attributes,
      'aria-readonly': this.props.readOnly ? 'true' : 'false',
      'data-field': isNil(this.props.field) ? undefined : this.props.field,
      'readOnly': this.props.readOnly ? 'readOnly' : undefined,
    }
  }

  get classNames(): Set<string> {
    return super.classNames.add('editor')
  }

  /**
   * Gets the current value, either from props (controlled) or state (uncontrolled)
   * @returns The current value
   */
  get current(): Value {
    return this.props.value !== undefined
      ? this.props.value
      : this.state.current
  }

  /**
   * Whether the editor is in controlled mode
   * @returns Whether the editor is in controlled mode
   */
  get controlled(): boolean {
    return this.props.value !== undefined
  }

  /**
   * Whether the editor is dirty
   * @returns Whether the editor is dirty
   */
  get dirty(): boolean {
    return !this.controlled && !deepEquals(this.current, this.props.initialValue)
  }

  /**
   * Handles value changes in both controlled and uncontrolled modes
   * @param value - The new value
   */
  protected handleChange = async (value: Value): Promise<void> => {
    const { field = '', onChange = noop } = this.props
    const currentValue = this.current

    // Short-circuit if the value is the same instance
    if (value === currentValue) return

    // Deep equality check to avoid unnecessary onChange calls
    if (deepEquals(value, currentValue)) return

    if (this.controlled) {
      onChange(value, field, this)
    } else {
      await this.setState({ current: value } as State extends TState<Value> ? State : State & TState<Value>, () => {
        onChange(value, field, this)
      })
    }
  }

  /**
   * Updates a nested field value using the provided path
   * @param value - The new value
   * @param path - The path to the nested field
   */
  protected handleField = async <Path extends PathOf<Value>>(
    value: TypeAt<Value, Path>,
    path: Path,
  ): Promise<void> => {
    const update = clone(this.current)

    const parts = path.split('.')
    const lastPart = parts.pop()
    if (!lastPart) return

    set(update, path, value)
    await this.handleChange(update)
  }

  content(children?: React.ReactNode): React.ReactNode {
    return super.content(
      (this.props.readOnly && typeof this.readOnly === 'function')
        ? this.readOnly(children)
        : children,
    )
  }

  /**
   * Renders the component's content in read-only mode.
   * @param children - The children to render in read-only mode.
   * @returns The component's content as a string representation.
   */
  readOnly(children?: React.ReactNode): React.ReactNode {
    return children
  }
}
