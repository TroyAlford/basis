/**
 * A deterministic, offline placeholder image.
 *
 * The docs must render identically with no network, so this returns an inline
 * SVG data URI rather than pointing at a placeholder service (which the test
 * network policy blocks, leaving a timing-dependent broken-image state).
 * @param width - Image width in pixels.
 * @param height - Image height in pixels.
 * @returns A data URI for a placeholder of the requested size.
 */
export const imageURL = (width: number, height: number): string => {
  const fontSize = Math.max(12, Math.round(Math.min(width, height) / 8))
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<rect width="100%" height="100%" fill="#e5e5e5"/>',
    `<text x="50%" y="50%" fill="#888" font-family="sans-serif" font-size="${fontSize}"`,
    ` text-anchor="middle" dominant-baseline="central">${width}×${height}</text>`,
    '</svg>',
  ].join('')

  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
