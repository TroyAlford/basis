import { createRoot } from 'react-dom/client'
import { Layout } from './components/Layout.tsx'

const container = document.getElementById('root')
if (container) {
  const root = createRoot(container)
  root.render(<Layout />)
}
