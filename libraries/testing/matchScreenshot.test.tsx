import { Button } from '@basis/react'
import { matchScreenshot, test } from '@basis/testing'

test('renders a button', async () => {
  await matchScreenshot(<Button>Save</Button>)
})
