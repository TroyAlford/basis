import type { PluginBuilder } from 'bun'
import { describe, expect, test } from 'bun:test'
import { pluginHMR, transformProductionModule } from './pluginHMR'

describe('transformProductionModule', () => {
  test('registers a named class export and accepts the module', () => {
    const result = transformProductionModule(
      'export class Button extends Component { render() { return <div /> } }',
      '/app/Button.tsx',
      '/app',
    )

    expect(result?.contents).toContain('import { register as __basisHMRRegister } from "basis/react/hmr"')
    expect(result?.contents).toContain('__basisHMRRegister("Button.tsx:Button", Button)')
    expect(result?.contents).toContain('Button.displayName = "Button"')
    expect(result?.contents).toContain('import.meta.hot.accept()')
    expect(result?.contents).toContain('react/jsx-runtime')
    expect(result?.contents).not.toContain('jsxDEV')
    expect(result?.contents).not.toContain('react-refresh')
    expect(result?.loader).toBe('js')
  })

  test('marks a class with runtime-private members as unstable', () => {
    const result = transformProductionModule(
      'export class Private extends Component { #value = 1; render() { return <div>{this.#value}</div> } }',
      '/app/Private.tsx',
      '/app',
    )

    expect(result?.contents).toContain('__basisHMRRegister("Private.tsx:Private", Private, true)')
  })

  test('rewrites a default class export to a live stable binding', () => {
    const result = transformProductionModule(
      'export default class Defaulted extends Component {}',
      '/app/Defaulted.tsx',
      '/app',
    )

    expect(result?.contents).toContain('class Defaulted extends Component')
    expect(result?.contents).not.toContain('export default class')
    expect(result?.contents).toContain('__basisHMRRegister("Defaulted.tsx:Defaulted", Defaulted)')
    expect(result?.contents).toContain('export default Defaulted')
  })

  test('pre-transforms JSX even when the module has no class or style', () => {
    const result = transformProductionModule('export const view = <main />', '/app/view.tsx', '/app')

    expect(result?.contents).toContain('react/jsx-runtime')
    expect(result?.contents).not.toContain('jsxDEV')
    expect(result?.contents).not.toContain('__basisHMRRegister')
    expect(result?.contents).not.toContain('import.meta.hot.accept()')
  })

  test('accepts a style module without registering a class', () => {
    const result = transformProductionModule("style('x', 'a{}')", '/app/Button.styles.ts', '/app')

    expect(result?.contents).toContain('import.meta.hot.accept()')
    expect(result?.contents).not.toContain('__basisHMRRegister')
    expect(result?.contents).not.toContain('react-refresh')
  })

  test('leaves a class-free non-style TypeScript module to Bun', () => {
    expect(transformProductionModule('export const x = 1', '/app/util.ts', '/app')).toBeNull()
  })
})

describe('pluginHMR', () => {
  /**
   * Run plugin setup against a stub builder and report whether it registered a loader.
   * @param nodeEnv - The NODE_ENV value to run under.
   * @param target - The build target.
   * @returns Whether `onLoad` was registered.
   */
  function registersLoader(nodeEnv: string | undefined, target: 'browser' | 'bun' = 'browser'): boolean {
    const previous = process.env.NODE_ENV
    if (nodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = nodeEnv

    try {
      let registered = false
      const build = {
        config: { target },
        onLoad: () => { registered = true },
      } as unknown as PluginBuilder
      pluginHMR().setup(build)
      return registered
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previous
    }
  }

  test('registers the production browser loader', () => {
    expect(registersLoader('production')).toBe(true)
  })

  test('does not register in development', () => {
    expect(registersLoader('development')).toBe(false)
    expect(registersLoader(undefined)).toBe(false)
  })

  test('can force the transform in development for vendor-backed previews', () => {
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'

    try {
      let registered = false
      const build = {
        config: { target: 'browser' },
        onLoad: () => { registered = true },
      } as unknown as PluginBuilder
      pluginHMR({ force: true }).setup(build)
      expect(registered).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previous
    }
  })

  test('does not register for the server target', () => {
    expect(registersLoader('production', 'bun')).toBe(false)
  })
})
