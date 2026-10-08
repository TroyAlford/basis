import { describe, expect, test } from 'bun:test'
import { classNames } from './pluginRefresh'

describe('classNames', () => {
  test('finds top-level class declarations, exported or not', () => {
    const source = [
      "import * as React from 'react'",
      'class Local extends React.Component {}',
      'export class Exported extends React.Component {}',
      'export default class Defaulted extends React.Component {}',
    ].join('\n')

    expect(classNames(source)).toEqual(['Local', 'Exported', 'Defaulted'])
  })

  test('ignores nested classes and class expressions that are not module bindings', () => {
    const source = [
      'class Outer extends React.Component {',
      '  static Divider = class MenuDivider {}',
      '  method() {',
      '    class Inner {}',
      '    return Inner',
      '  }',
      '}',
    ].join('\n')

    expect(classNames(source)).toEqual(['Outer'])
  })

  test('ignores modules with no class declarations', () => {
    expect(classNames('const value = 1\nexport function fn() { return value }')).toEqual([])
  })
})
