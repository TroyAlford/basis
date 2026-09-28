import type * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { themeStyles } from '../react/components/Theme/Theme'
import { style, styles } from '../react/utilities/style'

/**
 * Render a React element to a standalone HTML document.
 *
 * The markup comes from `react-dom/server`; every stylesheet registered through
 * Basis's `style()` utility (component styles and the default theme) is inlined
 * so the document is self-contained for a browser.
 *
 * The default theme is seeded here rather than at module load: `Theme` normally
 * injects its variables on mount, and a standalone render never mounts one, so
 * registering the defaults is part of rendering the document — not an ambient
 * side effect of importing `basis/testing`.
 * @param element - The element to render.
 * @returns A complete HTML document.
 */
export function renderHtml(element: React.ReactElement): string {
  style('basis:theme:default', themeStyles())
  const body = renderToStaticMarkup(element)
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><style>',
    styles(),
    'html,body{margin:0;padding:0;background:#fff}',
    '</style></head><body>',
    body,
    '</body></html>',
  ].join('')
}
