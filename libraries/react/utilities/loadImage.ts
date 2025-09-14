const CACHE = new Map<string, Promise<HTMLImageElement>>()

/**
 * Load an image and return a promise that resolves with the image element.
 * @param src - The source URL of the image.
 * @returns A promise that resolves with the image element or null if the image fails to load.
 */
export function loadImage(src: string): Promise<HTMLImageElement> {
  if (!CACHE.has(src)) {
    CACHE.set(src, new Promise(resolve => {
      const img = new window.Image()
      img.onload = () => resolve(img)
      img.onerror = () => resolve(null)
      img.src = src
    }))
  }

  return CACHE.get(src)
}
