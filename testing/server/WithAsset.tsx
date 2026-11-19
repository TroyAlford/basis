import * as React from 'react'
import pixel from './pixel.png'

/**
 * Fixture whose entrypoint imports an asset.
 * @returns The rendered fixture markup.
 */
export const Application = () => (
  <main data-testid="asset-application">
    <img alt="pixel" src={pixel} />
  </main>
)
