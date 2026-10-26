import parser from '@typescript-eslint/parser'
import { describe, expect, test } from 'bun:test'
import { Linter } from 'eslint'
import { componentArchitecture } from './componentArchitecture'

const CONFIG: Linter.Config = {
  files: ['**/*.ts', '**/*.tsx'],
  languageOptions: {
    parser,
    parserOptions: {
      ecmaFeatures: { jsx: true },
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
  },
  plugins: {
    test: {
      rules: {
        'component-architecture': componentArchitecture,
      },
    },
  },
  rules: {
    'test/component-architecture': 'error',
  },
}

const lint = (code: string, filename = 'fixture.tsx') => {
  const linter = new Linter()
  return linter.verify(code, [CONFIG], { filename })
}

const messageIds = (code: string, filename = 'fixture.tsx') => (
  lint(code, filename).map(message => message.messageId).sort()
)

describe('componentArchitecture hooks', () => {
  test('rejects a named React hook import', () => {
    expect(messageIds(`
import { useState } from 'react'
export class Example {
  value = useState(0)
}
`)).toEqual(['reactHook'])
  })

  test('rejects an aliased React hook import', () => {
    expect(messageIds(`
import { useEffect as effect } from 'react'
export class Example {
  value = effect(() => undefined)
}
`)).toEqual(['reactHook'])
  })

  test('rejects a namespace-qualified React hook call', () => {
    expect(messageIds(`
import * as React from 'react'
export class Example {
  value = React.useReducer(() => 0, 0)
}
`)).toEqual(['reactHook'])
  })

  test('rejects a default-import-qualified React hook call', () => {
    expect(messageIds(`
import React from 'react'
export class Example {
  value = React.useMemo(() => 0, [])
}
`)).toEqual(['reactHook'])
  })

  test('rejects a custom hook call', () => {
    expect(messageIds(`
import { useRemoteData } from './useRemoteData'
export function Example() {
  const value = useRemoteData()
  return <p>{value}</p>
}
`)).toEqual(['customHook', 'functionComponent'])
  })

  test('rejects an aliased custom hook import', () => {
    expect(messageIds(`
import { useRemoteData as load } from './useRemoteData'
export function Example() {
  const value = load()
  return <p>{value}</p>
}
`)).toEqual(['customHook', 'functionComponent'])
  })

  test('rejects a local pure useX call inside a component', () => {
    expect(messageIds(`
function useDiscount(code: string): string { return code.trim() }
export function Example() {
  const value = useDiscount('A')
  return <p>{value}</p>
}
`)).toEqual(['customHook', 'functionComponent'])
  })

  test('rejects a locally declared custom hook in React source', () => {
    expect(messageIds(`
import { useState } from 'react'
function useThing() { return useState(0) }
export class Example {
  value = useThing()
}
`)).toEqual(['customHook', 'reactHook'])
  })

  test('allows a pure useX utility in an ordinary domain module', () => {
    expect(messageIds(`
function useDiscount(code: string): string { return code.trim() }
export const discounted = useDiscount('A')
`, 'discount.ts')).toEqual([])
  })

  test('allows an imported pure useX utility without React context', () => {
    expect(messageIds(`
import { useDiscount } from './pricing'
export const discounted = useDiscount('A')
`, 'discount.ts')).toEqual([])
  })

  test('allows a local pure useX helper with unrelated JSX', () => {
    expect(messageIds(`
function useDiscount(code: string): string { return code.trim() }
const label = (value: string) => <span>{value}</span>
export const discounted = useDiscount('A')
export { label }
`, 'pricing.tsx')).toEqual([])
  })

  test('allows ordinary helpers and class methods that start with use', () => {
    expect(messageIds(`
const useful = (): number => 1
class Example {
  used = useful()
  useThing(): number { return 1 }
}
`)).toEqual([])
  })
})

describe('componentArchitecture function components', () => {
  test('rejects a React.FC annotation', () => {
    expect(messageIds(`
import * as React from 'react'
export const Hello: React.FC<{ name: string }> = () => <p>Hello</p>
`)).toEqual(['reactFunctionType'])
  })

  test('rejects an aliased FC annotation', () => {
    expect(messageIds(`
import type { FC as FunctionComponentAlias } from 'react'
export const Hello: FunctionComponentAlias = () => <p>Hello</p>
`)).toEqual(['reactFunctionType'])
  })

  test('rejects a memo wrapper around an inline function', () => {
    expect(messageIds(`
import { memo } from 'react'
export const Hello = memo(() => <p>Hello</p>)
`)).toEqual(['reactWrapper'])
  })

  test('rejects a forwardRef wrapper around an inline function', () => {
    expect(messageIds(`
import { forwardRef } from 'react'
export const Input = forwardRef((props, ref) => <input ref={ref} />)
`)).toEqual(['reactWrapper'])
  })

  test('rejects an exported arrow component', () => {
    expect(messageIds(`
export const Hello = ({ name }: { name: string }) => <p>Hello {name}</p>
`)).toEqual(['functionComponent'])
  })

  test('rejects an exported function declaration component', () => {
    expect(messageIds(`
export function Hello({ name }: { name: string }) {
  return <p>Hello {name}</p>
}
`)).toEqual(['functionComponent'])
  })

  test('rejects a default-exported arrow component', () => {
    expect(messageIds(`
export default () => <p>Hello</p>
`)).toEqual(['functionComponent'])
  })

  test('rejects an anonymous default function component', () => {
    expect(messageIds(`
export default function () {
  return <p>Hello</p>
}
`)).toEqual(['functionComponent'])
  })

  test('rejects an arrow component exported through a named export specifier', () => {
    expect(messageIds(`
const Hello = () => <p>Hello</p>
export { Hello }
`)).toEqual(['functionComponent'])
  })

  test('rejects a function component exported through a named export specifier', () => {
    expect(messageIds(`
function Hello() { return <p>Hello</p> }
export { Hello }
`)).toEqual(['functionComponent'])
  })

  test('rejects an aliased named export of a function component', () => {
    expect(messageIds(`
const Hello = () => <p>Hello</p>
export { Hello as Greeting }
`)).toEqual(['functionComponent'])
  })

  test('rejects a default export identifier pointing at a function component', () => {
    expect(messageIds(`
const Hello = () => <p>Hello</p>
export default Hello
`)).toEqual(['functionComponent'])
  })

  test('rejects an arrow helper exported under an uppercase component alias', () => {
    expect(messageIds(`
const renderLabel = () => <span>Hello</span>
export { renderLabel as Hello }
`)).toEqual(['functionComponent'])
  })

  test('rejects a function helper exported under an uppercase component alias', () => {
    expect(messageIds(`
function renderLabel() { return <span>Hello</span> }
export { renderLabel as Hello }
`)).toEqual(['functionComponent'])
  })

  test('allows a lowercase helper exported through a named export specifier', () => {
    expect(messageIds(`
const renderLabel = (value: string) => <span>{value}</span>
export { renderLabel }
`)).toEqual([])
  })

  test('rejects a local function used as a JSX component type', () => {
    expect(messageIds(`
const Hello = ({ name }: { name: string }) => <p>Hello {name}</p>
export class Example {
  content() { return <Hello name="world" /> }
}
`)).toEqual(['functionComponent'])
  })

  test('rejects a local function declaration used as a JSX component type', () => {
    expect(messageIds(`
function Hello() { return <p>Hello</p> }
export class Example {
  content() { return <Hello /> }
}
`)).toEqual(['functionComponent'])
  })

  test('rejects a local object property used as a JSX member component type', () => {
    expect(messageIds(`
const Views = { Card: () => <p>Card</p> }
export class Page {
  content() { return <Views.Card /> }
}
`)).toEqual(['functionComponent'])
  })

  test('rejects a nested local object property used as a JSX member component type', () => {
    expect(messageIds(`
const Views = { Cards: { Card: () => <p>Card</p> } }
export class Page {
  content() { return <Views.Cards.Card /> }
}
`)).toEqual(['functionComponent'])
  })

  test('allows a local class object property used as a JSX member component type', () => {
    expect(messageIds(`
import { Component } from 'basis/react'
class Card extends Component {}
const Views = { Card }
export class Page extends Component {
  content() { return <Views.Card /> }
}
`)).toEqual([])
  })

  test('allows an imported class object property used as a JSX member component type', () => {
    expect(messageIds(`
import { Card } from 'basis/react'
const Views = { Card }
export class Page {
  content() { return <Views.Card /> }
}
`)).toEqual([])
  })
})

describe('componentArchitecture class hierarchy', () => {
  test('rejects a class extending React.Component', () => {
    expect(messageIds(`
import * as React from 'react'
export class Legacy extends React.Component {
  render() { return null }
}
`)).toEqual(['reactClassBase'])
  })

  test('rejects a class extending a named React.Component import', () => {
    expect(messageIds(`
import { Component } from 'react'
export class Legacy extends Component {
  render() { return null }
}
`)).toEqual(['reactClassBase'])
  })

  test('rejects a class extending React.PureComponent', () => {
    expect(messageIds(`
import * as React from 'react'
export class Legacy extends React.PureComponent {}
`)).toEqual(['reactClassBase'])
  })

  test('allows a Basis Editor subclass', () => {
    expect(messageIds(`
import { Editor } from 'basis/react'
export class MyEditor extends Editor<string> {
  content() { return <input /> }
}
`)).toEqual([])
  })

  test('allows indirect Basis Component inheritance', () => {
    expect(messageIds(`
import { Component } from 'basis/react'
export class Parent extends Component {}
export class Child extends Parent {}
`)).toEqual([])
  })

  test('allows a deeper indirect Basis inheritance chain', () => {
    expect(messageIds(`
import { Component } from 'basis/react'
class Grandparent extends Component {}
class Parent extends Grandparent {}
export class Child extends Parent {}
`)).toEqual([])
  })
})

describe('componentArchitecture allowed source', () => {
  test('allows intrinsic JSX and rendered class instances', () => {
    expect(messageIds(`
import { Button, Component } from 'basis/react'
export class Example extends Component {
  content() { return <div><Button>Save</Button></div> }
}
`)).toEqual([])
  })

  test('allows pure helpers that return React nodes', () => {
    expect(messageIds(`
import type { ReactNode } from 'react'
export const renderLabel = (value: string): ReactNode => <span>{value}</span>
`)).toEqual([])
  })

  test('allows ordinary exported domain functions', () => {
    expect(messageIds(`
export const formatDate = (value: Date): string => value.toISOString()
export function buildQuery(id: string): string { return '?id=' + id }
`)).toEqual([])
  })

  test('allows React.createElement as an element expression', () => {
    expect(messageIds(`
import * as React from 'react'
export const renderIcon = (): React.ReactElement => React.createElement('span', null, 'icon')
`)).toEqual([])
  })
})

describe('componentArchitecture scope', () => {
  test('ignores test and screenshot files', () => {
    const code = `
import { useState } from 'react'
export const Hello: React.FC = () => {
  const [value] = useState(0)
  return <p>{value}</p>
}
`
    expect(messageIds(code, 'fixture.test.tsx')).toEqual([])
    expect(messageIds(code, 'fixture.screenshot.tsx')).toEqual([])
    expect(messageIds(code, 'fixture.e2e.tsx')).toEqual([])
  })

  test('ignores testing and fixture directories', () => {
    const code = `
import { useState } from 'react'
export const Hello = () => {
  const [value] = useState(0)
  return <p>{value}</p>
}
`
    expect(messageIds(code, 'libraries/react/testing/render.tsx')).toEqual([])
    expect(messageIds(code, 'src/__fixtures__/Hello.tsx')).toEqual([])
  })

  test('still reports application source', () => {
    expect(messageIds(`
import { useState } from 'react'
export const Hello = () => {
  const [value] = useState(0)
  return <p>{value}</p>
}
`, 'src/components/Hello.tsx')).toEqual(['functionComponent', 'reactHook'])
  })
})
