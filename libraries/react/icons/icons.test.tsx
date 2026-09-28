import { expect } from 'bun:test'
import type * as React from 'react'
import { describe, test } from '../../testing'
import * as Icons from '../icons'
import { IconBase } from './IconBase/IconBase'

/*
 * A visual registry: every icon, in each variant, captured to a committed
 * snapshot so a shape change is reviewable as an image diff.
 */
const entries = (Object.entries(Icons) as [string, unknown][])
  .filter(([, icon]) => IconBase.isIcon(icon))
  .sort(([a], [b]) => a.localeCompare(b)) as [string, typeof IconBase][]

/** Snapshot tolerance for anti-aliasing across machines. */
const TOLERANCE = { maxDiffPixels: 50 }

describe('icons', () => {
  for (const [name, Icon] of entries) {
    test(name, async () => {
      const Component = Icon as unknown as React.ComponentType<{ filled?: boolean }>
      await expect(<Component />).toMatchScreenshot('outline', TOLERANCE)
      await expect(<Component filled />).toMatchScreenshot('filled', TOLERANCE)
    })
  }
})
