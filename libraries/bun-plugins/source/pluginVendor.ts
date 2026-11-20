import type { BunPlugin } from 'bun'
import { vendorSpecifiers } from './vendorRuntime'

/** The virtual namespace that resolves vendor imports to their browser globals. */
const VENDOR_NAMESPACE = 'basis-vendor'

/**
 * Resolve imports discovered as client vendor dependencies to the vendor global.
 *
 * The Server discovers the client graph and builds the vendor bundle before the
 * application shell builds. Specifiers outside that set keep normal bundling, so
 * a Basis app without a Server or without vendor discovery continues to work.
 * @returns The Bun plugin.
 */
export function pluginVendor(): BunPlugin {
  return {
    name: 'basis-vendor',
    setup(build) {
      build.onResolve({ filter: /.*/ }, async args => {
        const specifiers = await vendorSpecifiers()
        if (!specifiers?.has(args.path)) return undefined
        return { namespace: VENDOR_NAMESPACE, path: args.path }
      })
      build.onLoad({ filter: /.*/, namespace: VENDOR_NAMESPACE }, args => ({
        contents: `module.exports = globalThis.__basisVendor[${JSON.stringify(args.path)}]`,
        loader: 'js',
      }))
    },
  }
}
