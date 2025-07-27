import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import * as React from 'react'
import { noop } from '@basis/utilities'
import { render } from '../../testing/render'
import * as loadImageModule from '../../utilities/loadImage'
import { Image } from './Image'

describe('Image', () => {
  const loadImage = spyOn(loadImageModule, 'loadImage')

  beforeEach(() => {
    loadImage.mockClear()
    Image.Cache.Loading.clear()
    Image.Cache.Resolved.clear()
  })

  afterAll(() => {
    loadImage.mockRestore()
    Image.Cache.Loading.clear()
    Image.Cache.Resolved.clear()
  })

  test('shares loading promise between instances', async () => {
    loadImage.mockImplementationOnce(() => new Promise(resolve => setTimeout(() => {
      const img = new window.Image()
      img.src = 'test.jpg'
      resolve(img)
    }, 10)))

    const { node: node1, update: update1 } = await render(<Image src="test.jpg" />)
    const { node: node2, update: update2 } = await render(<Image src="test.jpg" />)

    expect(loadImage).toHaveBeenCalledTimes(1)
    expect(Image.Cache.Loading.has('test.jpg')).toBe(true)
    expect(Image.Cache.Loading.size).toBe(1)

    // Wait for load to complete
    await Image.Cache.Loading.get('test.jpg')
    await update1()
    await update2()

    expect(node1.dataset.loaded).toBe('true')
    expect(node2.dataset.loaded).toBe('true')
    expect(Image.Cache.Resolved.has('test.jpg')).toBe(true)
    expect(Image.Cache.Loading.size).toBe(0)
  })

  test('handles load errors', async () => {
    loadImage.mockImplementationOnce(() => (
      Promise.reject('Load failed').catch(() => null)
    ))
    const { node, update } = await render(<Image src="error.jpg" />)

    const loading = Image.Cache.Loading.get('error.jpg')
    if (loading) await loading.catch(noop)

    await update()

    expect(node.dataset.error).toBe('true')
    expect(Image.Cache.Loading.has('error.jpg')).toBe(false)
    expect(Image.Cache.Resolved.has('error.jpg')).toBe(false)
  })
})
