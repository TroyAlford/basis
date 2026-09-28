import { expect } from 'bun:test'
import { Button } from '@basis/react'
import { test } from '@basis/testing'

test('renders a button', async () => {
  await expect(<Button>Save</Button>).toMatchScreenshot()
})
