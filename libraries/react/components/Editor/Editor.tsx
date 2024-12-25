import { clone, noop, set } from '@basis/utilities'
import type { ComponentProps } from '../Component/Component'
import { Component } from '../Component/Component'

interface EditorProps<
  Value,
  Element extends HTMLElement = HTMLDivElement,
> extends ComponentProps<Element> {
  /** Field identifier (number or string) */
  field?: number | string,
  /** Initial value for uncontrolled mode */
  initialValue?: Value,
  /** Change handler */
  onChange?: (
    /** The new value */
    value: Value,
    /** The field identifier */
    field: number | string,
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

interface EditorState<TValue> {
  /** Current value in uncontrolled mode */
  current: TValue,
}

/**
 * Abstract base class for editor components.
 * Extends Component to provide common editor functionality.
 */
// @ts-expect-error - TS struggles with this typing for some reason
export abstract class Editor<
  Value = unknown,
  Element extends HTMLElement = HTMLDivElement,
  Props = EditorProps<Value, Element>,
  State = EditorState<Value>,
> extends Component<Props & EditorProps<Value, Element>, Element, State & EditorState<Value>> {
  static defaultProps: Partial<EditorProps<unknown>> = {
    ...super.defaultProps,
    onChange: noop,
    readOnly: false,
  }

  /**
   * Checks if a constructor is an Editor
   * @param ctor - The constructor to check
   * @returns Whether the constructor is an Editor
   */
  static isEditor(ctor: unknown): ctor is new (...args: unknown[]) => Editor {
    if (ctor === Editor) return true
    if (ctor instanceof Editor) return true
    return typeof ctor === 'function' && ctor.prototype instanceof Editor
  }

  get defaultState(): State & EditorState<Value> {
    return {
      ...super.defaultState,
      current: this.props.value ?? this.props.initialValue,
    }
  }

  get aria(): Record<string, string> {
    return {
      ...super.aria,
      readonly: this.props.readOnly ? 'true' : 'false',
    }
  }
  get attributes(): (typeof this)['attributes'] {
    return {
      ...super.attributes,
      readOnly: this.props.readOnly ? 'readOnly' : undefined,
    }
  }

  get classNames(): Set<string> {
    const { field } = this.props
    switch (typeof field) {
      case 'number': return super.classNames.add('editor').add(`index-${field}`)
      case 'string': return super.classNames.add('editor').add(field)
      default: return super.classNames.add('editor')
    }
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
  protected handleChange = (value: Value): void => {
    const { field = '', onChange = noop } = this.props

    if (this.controlled) {
      onChange(value, field, this)
    } else {
      this.setState({ current: value } as State, () => {
        onChange(value, field, this)
      })
    }
  }

  /**
   * Updates a nested field value using the provided path
   * @param value - The new value
   * @param path - The path to the nested field
   */
  protected handleField = (value: unknown, path: string): void => {
    const update = clone(this.current)

    const parts = path.split('.')
    const lastPart = parts.pop()
    if (!lastPart) return

    set(path, update, value)
    this.handleChange(update)
  }
}
