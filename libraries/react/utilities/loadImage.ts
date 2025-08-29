/**
 * Load an image and return a promise that resolves with the image element.
 * @param src - The source URL of the image.
 * @returns A promise that resolves with the image element.
 * @throws An error if the image fails to load.
 */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(`Failed to load image: ${src}`)
    img.src = src
  })
}
