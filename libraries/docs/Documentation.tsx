import React from 'react'
import { createRoot } from 'react-dom/client'
import { Carousel } from '@basis/react/components/Carousel/Carousel'

export class Documentation extends React.Component {
  render() {
    return (
      <div className="documentation">
        <header>
          <h1>Documentation</h1>
        </header>
        <main>
          <div style={{
            background: 'aliceblue',
            border: '1px solid black',
            height: '500px',
            width: '500px',
          }}
          >
            <Carousel
              size={Carousel.Size.Contain}
              images={[
                { align: Carousel.Align.NorthWest, url: 'https://via.placeholder.com/150' },
                { align: Carousel.Align.Center, url: 'https://via.placeholder.com/250' },
                { align: Carousel.Align.East, url: 'https://via.placeholder.com/350' },
              ]}
            />
          </div>
        </main>
      </div>
    )
  }
}

// Create root and render
const container = document.getElementById('root')
if (container) {
  const root = createRoot(container)
  root.render(<Documentation />)
}
