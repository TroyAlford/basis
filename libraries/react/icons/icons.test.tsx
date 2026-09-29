import type * as React from 'react'
import { describe, matchScreenshot, test } from '../../testing'
import * as Icons from '../icons'
import { IconBase } from './IconBase/IconBase'

/*
 * A visual registry: every icon captured to a committed snapshot so a shape
 * change is reviewable as an image diff. Each icon renders once as a matrix —
 * small/medium/large side by side, with outline and filled as two rows — so a
 * single image shows both the silhouette at each scale and the two variants.
 */
const entries = (Object.entries(Icons) as [string, unknown][])
  .filter(([, icon]) => IconBase.isIcon(icon))
  .sort(([a], [b]) => a.localeCompare(b)) as [string, typeof IconBase][]

/** The three sizes shown side by side, in pixels (a 1:2:4 progression). */
const SIZES = [
  { label: 'Small', pixels: 48 },
  { label: 'Medium', pixels: 96 },
  { label: 'Large', pixels: 192 },
] as const

/** The two variants shown as rows. */
const VARIANTS = [
  { filled: false, label: 'Outline' },
  { filled: true, label: 'Filled' },
] as const

/*
 * Wide enough for anti-aliasing at the large (192px) size across machines; a
 * real shape change moves far more than this.
 */
const TOLERANCE = { maxDiffPixelRatio: 0.03 }

/** Column and row labels. */
const LABEL_STYLE: React.CSSProperties = {
  color: '#666',
  font: '600 14px system-ui, sans-serif',
}

/**
 * Render one icon as a sizes-by-variants matrix.
 * @param props - The icon component to render.
 * @param props.Icon - The icon component under test.
 * @returns The matrix element.
 */
function IconMatrix({ Icon }: { Icon: React.ComponentType<{ filled?: boolean }> }): React.ReactNode {
  const cells: React.ReactNode[] = [<span key="corner" />]
  for (const size of SIZES) {
    cells.push(<span key={`head:${size.label}`} style={LABEL_STYLE}>{size.label}</span>)
  }
  for (const variant of VARIANTS) {
    cells.push(
      <span key={`row:${variant.label}`} style={{ ...LABEL_STYLE, justifySelf: 'start' }}>
        {variant.label}
      </span>,
    )
    for (const size of SIZES) {
      cells.push(
        <span
          key={`${variant.label}:${size.label}`}
          style={{ '--basis-icon-size': `${size.pixels}px`, 'display': 'inline-flex' } as React.CSSProperties}
        >
          <Icon filled={variant.filled} />
        </span>,
      )
    }
  }
  return (
    <div
      style={{
        alignItems: 'center',
        background: '#fff',
        display: 'grid',
        gap: 24,
        gridTemplateColumns: 'auto repeat(3, 1fr)',
        justifyItems: 'center',
        padding: 24,
      }}
    >
      {cells}
    </div>
  )
}

describe('icons', () => {
  for (const [name, Icon] of entries) {
    test(name, async () => {
      const Component = Icon as unknown as React.ComponentType<{ filled?: boolean }>
      await matchScreenshot(<IconMatrix Icon={Component} />, 'sizes', TOLERANCE)
    })
  }
})
