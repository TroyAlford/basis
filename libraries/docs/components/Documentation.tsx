import { Editor } from '@basis/react'

export class Documentation<T> extends Editor<T> {
  get classNames() {
    return super.classNames.add('documentation')
  }

  override content(): React.ReactNode {
    return null
  }
}
