import { describe, expect, test } from 'bun:test'

describe('Table styles', () => {
  test('vertically centers header and body cells by default', async () => {
    // Import at test time so the injected stylesheet exists after the DOM is ready.
    await import('./Table.styles.ts')

    const styles = document.getElementById('basis:table')?.textContent ?? ''

    expect(styles).toContain('vertical-align: middle')
  })
})
