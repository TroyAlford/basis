import { describe, expect, test } from 'bun:test'
import { classNames, transformModule } from './pluginRefresh'

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

describe('transformModule', () => {
  test('registers top-level classes and accepts the module', () => {
    const result = transformModule('export class Button extends Component {}', '/app/Button.tsx', '/app')

    expect(result?.contents).toContain('import { register } from "react-refresh/runtime"')
    expect(result?.contents).toContain('register(Button, "Button.tsx:Button")')
    expect(result?.contents).toContain('import.meta.hot.accept()')
    expect(result?.loader).toBe('tsx')
  })

  test('accepts a style module even though it declares no classes', () => {
    const result = transformModule("style('x', 'a{}')", '/app/Button.styles.ts', '/app')

    expect(result?.contents).toContain('import.meta.hot.accept()')
    expect(result?.contents).not.toContain('react-refresh')
    expect(result?.loader).toBe('ts')
  })

  test('leaves a class-free, non-style module untouched', () => {
    expect(transformModule('export const x = 1', '/app/util.ts', '/app')).toBeNull()
  })
})
