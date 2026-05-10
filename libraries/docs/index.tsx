import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Layout } from './components/Layout.tsx'

import './index.styles.ts'

const container = document.getElementById('root')
if (container) {
  const root = createRoot(container)
  root.render(<Layout />)
}
