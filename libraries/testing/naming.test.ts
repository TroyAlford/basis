import { describe, expect, test } from 'bun:test'
import { formatSnapshotKey, slug } from './naming'

describe('testing/naming', () => {
  test('formats keys the way Bun snapshots are keyed', () => {
    expect(formatSnapshotKey('renders a button', undefined, 1)).toBe('renders a button 1')
    expect(formatSnapshotKey('renders a button', 'primary', 2)).toBe(
      'renders a button: primary 2',
    )
  })

  test('slugifies keys into filenames', () => {
    expect(slug('renders a button 1')).toBe('renders-a-button-1')
    expect(slug('renders a button: primary 2')).toBe('renders-a-button-primary-2')
    expect(slug('***')).toBe('snapshot')
  })
})
