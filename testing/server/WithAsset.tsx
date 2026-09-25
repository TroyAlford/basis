import * as React from 'react'
import { createRoot } from 'react-dom/client'
import pixel from './pixel.png'

/**
 * Fixture whose entrypoint exports a binding and imports an asset, exercising
 * both the classic-script/IIFE contract (an exported binding must not leave an
 * `export{…}` in the served bundle) and bundler-emitted asset serving.
 * @returns The rendered fixture markup.
 */
export const AssetApplication = () => (
  <main data-testid="asset-application">
    <img alt="pixel" src={pixel} />
  </main>
)

const root = document.getElementById('root')
if (root) createRoot(root).render(<AssetApplication />)
