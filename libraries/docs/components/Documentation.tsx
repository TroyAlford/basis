import type * as React from 'react'
import { Editor } from '../../react/components/Editor/Editor'

export class Documentation<T> extends Editor<T> {
  content(): React.ReactNode {
    return null
  }
}
