#!/usr/bin/env bun
import { buildDocumentationNavigation } from 'basis/react'
import { resolve } from 'node:path'
import { buildDocs, discoverDocs } from '../server/source/mdxToHTML'
import { routes } from './routes'

/*
 * Basis's own documentation build.
 *
 * `basis docs build` remains the generic consumer command; this entrypoint
 * composes Basis's live route inventory with the Markdown/docs tree so the
 * static site and the live app publish the same pages and navigation.
 */

const root = resolve(import.meta.dir, '..', '..')

/**
 * Read a `--flag value` argument.
 * @param flag - Flag name.
 * @param fallback - Value when the flag is absent.
 * @returns The resolved value.
 */
function value(flag: string, fallback: string): string {
  const index = Bun.argv.indexOf(flag)
  const found = Bun.argv[index + 1]
  return index !== -1 && found !== undefined && !found.startsWith('-') ? found : fallback
}

const navigation = buildDocumentationNavigation(routes.map(route => ({
  href: route.path,
  parent: route.parent,
  section: route.section,
  title: route.title.split('/').pop() ?? route.title,
})))

const site = discoverDocs({
  navigation,
  pages: routes.filter(route => !route.section && !route.markdown).map(route => ({
    component: route.component,
    path: route.path,
    title: route.title,
  })),
  root: resolve(root, 'docs'),
  route: '/',
  title: value('--title', 'Basis'),
})

const written = await buildDocs(site, resolve(root, value('--out', 'docs-dist')), value('--base', ''))
process.stdout.write(`[basis] docs: built ${written.length} page(s)\n`)
