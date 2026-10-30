import { createRoot } from 'react-dom/client'
import { Hello } from './Hello.tsx'

const container = document.getElementById('root')
if (container) {
  createRoot(container).render(<Hello name="Basis" />)
}
