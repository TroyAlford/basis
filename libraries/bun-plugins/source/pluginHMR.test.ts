import { tempDirectory } from 'basis/testing'
import type { PluginBuilder } from 'bun'
import { describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isInstalledDependency, pluginHMR, transformProductionModule } from './pluginHMR'

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

  test('marks a class with instance function fields as unstable', () => {
    const result = transformProductionModule(
      'export class Handler extends Component { onClick = () => "clicked"; render() { return <button /> } }',
      '/app/Handler.tsx',
      '/app',
    )

    expect(result?.contents).toContain('__basisHMRRegister("Handler.tsx:Handler", Handler, true)')
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

  test('leaves an unsupported module without an accept boundary so Bun reloads it', () => {
    expect(transformProductionModule('export const x = 1', '/app/util.ts', '/app')).toBeNull()
  })
})

describe('isInstalledDependency', () => {
  test('classifies workspace source behind a node_modules symlink as first-party', () => {
    const root = tempDirectory('basis-hmr-workspace-')
    try {
      const workspace = join(root, 'packages', 'widget')
      const modules = join(root, 'node_modules')
      mkdirSync(workspace, { recursive: true })
      mkdirSync(modules, { recursive: true })
      writeFileSync(join(workspace, 'index.tsx'), 'export class Widget extends Component {}')
      symlinkSync(workspace, join(modules, 'widget'), 'dir')

      expect(isInstalledDependency(join(modules, 'widget', 'index.tsx'))).toBe(false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('classifies genuine installed dependencies as third-party', () => {
    const root = tempDirectory('basis-hmr-dependency-')
    try {
      const file = join(root, 'node_modules', 'third-party', 'index.tsx')
      mkdirSync(join(root, 'node_modules', 'third-party'), { recursive: true })
      writeFileSync(file, 'export const value = <span />')

      expect(isInstalledDependency(file)).toBe(true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
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

  test('transforms workspace source but skips a genuine installed dependency', async () => {
    const root = tempDirectory('basis-hmr-classification-')
    try {
      const workspace = join(root, 'packages', 'widget')
      const modules = join(root, 'node_modules')
      mkdirSync(workspace, { recursive: true })
      mkdirSync(join(modules, 'third-party'), { recursive: true })
      const workspaceFile = join(workspace, 'index.tsx')
      const thirdPartyFile = join(modules, 'third-party', 'index.tsx')
      writeFileSync(workspaceFile, 'export class Widget extends Component { render() { return <span /> } }')
      writeFileSync(thirdPartyFile, 'export const value = <span />')
      symlinkSync(workspace, join(modules, 'widget'), 'dir')

      let load: ((args: { path: string }) => Promise<{ contents: string } | undefined>) | undefined
      const build = {
        config: { target: 'browser' },
        onLoad: (_filter: RegExp, callback: typeof load) => { load = callback },
      } as unknown as PluginBuilder
      pluginHMR({ force: true }).setup(build)
      if (!load) throw new Error('plugin did not register an onLoad callback')

      const firstParty = await load({ path: join(modules, 'widget', 'index.tsx') })
      expect(firstParty?.contents).toContain('react/jsx-runtime')
      expect(firstParty?.contents).toContain('__basisHMRRegister')
      expect(firstParty?.contents).not.toContain('jsxDEV')
      await expect(load({ path: thirdPartyFile })).resolves.toBeUndefined()
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('does not register for the server target', () => {
    expect(registersLoader('production', 'bun')).toBe(false)
  })
})
