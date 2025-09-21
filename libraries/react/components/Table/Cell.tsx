import * as React from 'react'
import type { PathOf } from '../../../utilities/types/PathOf'
import type { IPinnable } from '../../mixins/Pinnable'
import { Pinnable } from '../../mixins/Pinnable'
import type { Mixin } from '../../types/Mixin'
import type { TextAlign } from '../../types/TextAlign'
import { CheckboxEditor } from '../CheckboxEditor/CheckboxEditor.tsx'
import { Editor } from '../Editor/Editor'
import { EnumEditor } from '../EnumEditor/EnumEditor'
import { NumberEditor } from '../NumberEditor/NumberEditor'
import { TextEditor } from '../TextEditor/TextEditor'
import { ColumnType } from './Column'

import './Cell.styles.ts'

type Props<TRow, TField extends PathOf<TRow> = PathOf<TRow>> = {
  align?: TextAlign,
  enum?: Record<string, string | number>,
  field: TField,
  header?: boolean,
  onChange?: (value: unknown, field: string, editor: unknown) => void,
  readOnly?: boolean,
  row: TRow,
  type?: ColumnType,
  value?: unknown,
} & IPinnable

export class Cell<TRow, TField extends PathOf<TRow> = PathOf<TRow>>
  extends Editor<unknown, HTMLTableCellElement, Props<TRow, TField>> {
  static displayName = 'Table.Cell'
  static get mixins(): Set<Mixin> {
    return super.mixins.add(Pinnable)
  }

  get attributes() {
    return {
      ...super.attributes,
      'data-align': this.props.align,
      'data-field': this.props.field,
      'data-type': this.props.type,
    }
  }

  get tag(): keyof React.JSX.IntrinsicElements {
    return this.props.header ? 'th' : 'td'
  }

  private getValueAtPath(obj: unknown, path: string): unknown {
    return path.split('.').reduce((current: unknown, key) => (current as Record<string, unknown>)?.[key], obj)
  }

  get current(): unknown {
    const { field, row, value } = this.props
    // If value is provided directly, use it; otherwise extract from row
    return value !== undefined ? value : this.getValueAtPath(row, field)
  }

  content(): React.ReactNode {
    const { enum: enumOptions, field, readOnly, type = ColumnType.Text } = this.props
    const value = this.current

    switch (type) {
      case ColumnType.Number:
        return super.content(
          <NumberEditor
            field={field}
            readOnly={readOnly}
            value={value as number}
            onChange={this.handleChange}
          />,
        )

      case ColumnType.Boolean:
        return super.content(
          <CheckboxEditor
            field={field}
            readOnly={readOnly}
            value={value as boolean}
            onChange={this.handleChange}
          />,
        )

      case ColumnType.Enum:
        if (enumOptions) {
          return super.content(
            <EnumEditor
              enum={enumOptions}
              field={field}
              readOnly={readOnly}
              value={value as string | number}
              onChange={this.handleChange}
            />,
          )
        } else {
          return super.content(String(value || ''))
        }

      case ColumnType.Date:
        // For now, render as text since we don't have a DateEditor
        return super.content(
          value ? new Date(value as string).toLocaleDateString() : '',
        )

      case ColumnType.Text:
      default:
        return super.content(
          <TextEditor
            field={field}
            readOnly={readOnly}
            value={value as string}
            onChange={this.handleChange}
          />,
        )
    }
  }
}
