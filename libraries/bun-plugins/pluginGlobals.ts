import type { BunPlugin } from 'bun'

/**
 * A function that takes a module name and returns either a global variable reference
 * or undefined if the module should be ignored.
 * @param moduleName - The name of the module being imported
 * @returns A string containing the global variable reference, or undefined
 */
type GlobalResolveFunc = (moduleName: string) => string | undefined

/**
 * Configuration options for the globals plugin. The key is the module name to intercept,
 * and the value is either a string containing the global variable reference or a function
 * that returns the global variable reference.
 * @example Simple global mapping
 * {
 *   // Maps `import React from 'react'` to `window.React`
 *   'react': 'window.React',
 *   // Maps all react-dom imports (including subpaths) to window.ReactDOM
 *   'react-dom': 'window.ReactDOM',
 *   'react-dom/(.*)': 'window.ReactDOM',
 *   // Maps `import $ from 'jquery'` to `window.jQuery`
 *   'jquery': 'window.jQuery'
 * }
 * @example Using a resolver function
 * {
 *   // Maps any import from '@scope/*' to a global variable
 *   '@scope/(.*)': (name) => `window.Scope.${name.split('/')[1]}`,
 *   // Maps specific versions of a package to different globals
 *   'lodash-(.*)': (name) => `window.lodash.${name.split('-')[1]}`,
 *   // Conditionally map imports
 *   'my-lib': (name) => process.env.NODE_ENV === 'development'
 *     ? 'window.MyLibDev'
 *     : 'window.MyLib'
 * }
 * @example Usage with Bun
 * import { build } from "bun";
 * import { pluginGlobals } from "./pluginGlobals";
 *
 * await build({
 *   entrypoints: ['./src/index.ts'],
 *   plugins: [
 *     pluginGlobals({
 *       'react': 'window.React',
 *       'react-dom': 'window.ReactDOM',
 *       '@company/(.*)': (name) => `window.Company.${name.split('/')[1]}`
 *     })
 *   ]
 * });
 */
type PluginGlobalsOptions = Record<string, string | GlobalResolveFunc>

/**
 * Generate the resolve filter for a given set of globals.
 * @param globals - The set of globals to generate the filter for.
 * @returns A regular expression that matches the module names.
 * @internal
 */
function generateResolveFilter(globals: PluginGlobalsOptions) {
  const moduleNames = Object.keys(globals)
  return new RegExp(`^(${moduleNames.join('|')})(/.*)?$`)
}

/**
 * Generate the export for a given module name.
 * @param globals - The set of globals to generate the export for.
 * @param name - The module name to generate the export for.
 * @returns The export for the module name.
 * @internal
 */
function generateExport(globals: PluginGlobalsOptions, name: string): string | undefined {
  let match = Object.entries(globals).find(([pattern]) => new RegExp(`^${pattern}$`).test(name))

  if (!match) {
    const baseName = name.split('/')[0]
    match = Object.entries(globals).find(([pattern]) => new RegExp(`^${pattern}$`).test(baseName))
  }

  if (match) {
    const output = typeof match[1] === 'function' ? match[1](name) : match[1]
    return output ? `module.exports = ${output}` : undefined
  }
  return undefined
}

/**
 * Creates a Bun build plugin that maps module imports to global variables.
 * This is useful when you want to use modules that are loaded via script tags
 * or other means that expose global variables.
 * @param globals - Configuration object that maps module names to global variables
 * @returns A Bun build plugin that handles the global variable mapping
 * @example
 * // Basic usage
 * pluginGlobals({
 *   'react': 'window.React',
 *   'react-dom': 'window.ReactDOM'
 * })
 *
 * // Advanced usage with patterns
 * pluginGlobals({
 *   '@company/(.*)': (name) => `window.Company.${name.split('/')[1]}`,
 *   'legacy-(.*)': (name) => `window.Legacy['${name}']`
 * })
 */
export const pluginGlobals = (globals: PluginGlobalsOptions = {}) => {
  const filter = generateResolveFilter(globals)
  return {
    name: 'globals',
    setup(build) {
      build.onResolve({ filter }, args => ({ namespace: 'globals', path: args.path }))
      build.onLoad({ filter: /.*/, namespace: 'globals' }, args => {
        const name = args.path
        const contents = generateExport(globals, name)
        if (contents) {
          return { contents }
        }
        return null
      })
    },
  } as BunPlugin
}
