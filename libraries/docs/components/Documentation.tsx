import { Editor } from '@basis/react'

/**
 * Docs pages extend {@link Editor} for demo state (`current`, `handleField`, etc.) but are not
 * persisted user documents; they must not participate in Router leave guards.
 *
 * Sets a default empty-object {@link Editor.props.initialValue} so `current` and `dirty` line up
 * with {@link Editor} without each page re-declaring baseline state. The type parameter defaults to
 * {@link Record} for untyped docs; concrete demo state interfaces use `extends object` because they
 * do not carry a string index signature.
 */
export class Documentation<
  T extends object = Record<string, unknown>,
> extends Editor<T> {
  static override defaultProps = {
    ...Editor.defaultProps,
    initialValue: {},
  }

  get classNames() {
    return super.classNames.add('documentation')
  }

  override content() {
    return null
  }

  override get dirty(): boolean {
    return false
  }
}
