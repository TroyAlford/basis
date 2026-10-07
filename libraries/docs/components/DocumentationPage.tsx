import { Editor } from 'basis/react'

/**
 * Base class for the gallery pages in this docs app. It extends {@link Editor}
 * so a page gets demo state (`current`, `handleField`, etc.), and forces `dirty`
 * to `false` so a route change never prompts a leave guard. A default
 * empty-object {@link Editor.props.initialValue} keeps `current` and `dirty`
 * lined up without each page re-declaring baseline state.
 *
 * The type parameter defaults to {@link Record} for untyped pages; pages with
 * demo state use an interface that `extends object`.
 */
export class DocumentationPage<
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
