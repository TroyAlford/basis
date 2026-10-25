import { describe, expect, test } from 'bun:test'
import { render } from '../testing/render'
import { Intent as IntentEnum } from '../types/Intent'
import { Intent } from './Intent'

describe('Intent icon', () => {
  test('renders the intent glyph filled by default', async () => {
    const { node, unmount } = await render(<Intent intent={IntentEnum.Danger} />)

    expect(node.querySelector('path[mask]')).toBeTruthy()

    unmount()
  })

  test('honors an explicit outline', async () => {
    const { node, unmount } = await render(<Intent filled={false} intent={IntentEnum.Success} />)

    expect(node.querySelector('path[mask]')).toBeNull()

    unmount()
  })
})
