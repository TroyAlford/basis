import { describe, expect, test } from 'bun:test'
import * as React from 'react'
import { ICON_SOURCES } from '../../../scripts/svgToIcon'
import { render } from '../testing/render'
import type { IconProps } from './IconBase/IconBase'
import { IconBase } from './IconBase/IconBase'

describe('TinyMCE editor icons', () => {
  for (const name of Object.keys(ICON_SOURCES).sort()) {
    test(`${name} is an IconBase with the basis viewBox and path data`, async () => {
      const module = await import(`./${name}`) as Record<string, unknown>
      const Icon = module[name]
      expect(IconBase.isIcon(Icon)).toBe(true)

      const { node } = await render(React.createElement(Icon as React.ComponentType<IconProps>))
      expect(node.getAttribute('viewBox')).toBe('-100 -100 200 200')
      expect(node.querySelector('path')?.getAttribute('d')?.length).toBeGreaterThan(0)
      expect(node.querySelector('path')?.getAttribute('fill-rule')).toBe('evenodd')
      expect(node.querySelector('path')?.getAttribute('stroke-width')).toBe('10')
    })
  }
})
