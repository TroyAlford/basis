import { clone, deepEquals, isNil, noop, set } from '@basis/utilities'
import { Component } from '../Component/Component'

interface TProps<Value> {
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

type P<V, T> = TProps<V> & T
type S<V, T> = TState<V> & T

/**
 * Abstract base class for editor components.
 * Extends Component to provide common editor functionality.
 */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - TS2589: Type instantiation is excessively deep and possibly infinite.
export abstract class Editor<
  Value,
  Element extends HTMLElement = HTMLElement,
  Props = TProps<Value>,
  State = TState<Value>,
> extends Component<P<Value, Props>, Element, S<Value, State>> {
  static defaultProps: Partial<TProps<unknown> & Component['props']> = {
    ...super.defaultProps,
    onChange: noop,
    readOnly: false,
  }

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
    const classes = super.classNames.add('editor')
    if (this.props.field !== undefined) {
      classes.add(String(this.props.field))
    }
    return classes
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
  protected handleField = async (value: unknown, path: string): Promise<void> => {
    const update = clone(this.current)

    const parts = path.split('.')
    const lastPart = parts.pop()
    if (!lastPart) return

    set(path, update, value)
    await this.handleChange(update)
  }

  content(children?: React.ReactNode): React.ReactNode {
    return super.content(
      (this.props.readOnly && typeof this.readOnly === 'function')
        ? this.readOnly()
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
