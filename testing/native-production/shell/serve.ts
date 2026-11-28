import { pluginMarkdown, pluginSASS } from 'basis/serve'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { setVendorSpecifiers } from '../../../libraries/bun-plugins/source/vendorRuntime'
import { DEV_SHELL_ROUTE, devShellDirectory, writeDevShell, writeHydrationEntry } from '../../../libraries/server/source/DevShell'
import { buildVendorBundle, discoverVendorSpecifiers } from '../../../libraries/server/source/Vendor'
import { Application } from './Application'

const root = import.meta.dir
const variant = Bun.env.NATIVE_VARIANT ?? 'A'
const warmMode = Bun.env.NATIVE_WARM ?? 'concurrent'
const mainPath = join(root, 'Application.tsx')
const entrypoint = writeHydrationEntry({ directory: join(root, '.basis'), mainPath })
const directory = devShellDirectory(JSON.stringify([root, 'Native shell', mainPath]))
const shell = writeDevShell({ directory, entrypoints: [entrypoint], title: 'Native shell' })
const appHtml = renderToString(React.createElement(Application))
let shellHtml = readFileSync(shell, 'utf8').replace('<div id="root"></div>', `<div id="root">${appHtml}</div>`)
if (variant !== 'A' && variant !== 'B') {
  shellHtml = shellHtml.replace('<!-- VENDORS -->', '<script src="/assets/vendor/vendor.js"></script>')
}
writeFileSync(shell, shellHtml)

let vendorReady: Promise<ReadonlySet<string>> = Promise.resolve(new Set())
if (variant === 'B') {
  setVendorSpecifiers(Promise.resolve(new Set()))
}
if (variant === 'C' || variant === 'D') {
  writeFileSync(join(root, '.basis', `vendor-start-${variant}.txt`), 'started')
  vendorReady = discoverVendorSpecifiers({
    entrypoint,
    plugins: [pluginSASS(), pluginMarkdown()],
    root,
  }).then(async specifiers => {
    writeFileSync(join(root, '.basis', `vendor-discovered-${variant}.json`), JSON.stringify({ specifiers }))
    await buildVendorBundle({ root, specifiers })
    writeFileSync(join(root, '.basis', `vendor-ready-${variant}.json`), JSON.stringify({ specifiers }))
    setVendorSpecifiers(Promise.resolve(new Set(specifiers)))
    return new Set(specifiers)
  }).catch(error => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error)
    writeFileSync(join(root, '.basis', `vendor-error-${variant}.txt`), message)
    throw error
  })
  setVendorSpecifiers(vendorReady)
}

let shellBundle: Bun.HTMLBundle
if (warmMode === 'sequential' && variant === 'D') {
  await vendorReady
  shellBundle = import.meta.require(shell)
} else {
  shellBundle = import.meta.require(shell)
}
// eslint-disable-next-line @basis/no-custom-test-server -- Generated-shell native production diagnostic.
const server = Bun.serve({
  development: false,
  hostname: '127.0.0.1',
  port: Number(Bun.env.PORT ?? 0),
  routes: {
    '/': shellBundle,
    '/api/health': () => Response.json({ status: 'ok' }),
    '/assets/vendor/vendor.js': () => new Response(Bun.file(join(root, 'dist', 'vendor', 'vendor.js'))),
    [DEV_SHELL_ROUTE]: shellBundle,
  },
})

if (warmMode === 'concurrent' || variant === 'D') {
  void Bun.fetch(`${server.url}${DEV_SHELL_ROUTE}`).catch(error => {
    process.stderr.write(`native shell warm failed: ${error instanceof Error ? error.message : String(error)}\n`)
  })
}
