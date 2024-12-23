import React from 'react'
import { createRoot } from 'react-dom/client'
import { Carousel } from '@basis/react/components/Carousel/Carousel'
import { Theme } from '@basis/react/components/Theme/Theme'

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
            width: '250px',
          }}
          >
            <Theme />
            <Carousel altText="Example carousel" size={Carousel.Size.Fill}>
              <img alt="Square 150x150" src="https://picsum.photos/150/150" />
              <img alt="Square 250x250" src="https://picsum.photos/250/250" />
              <img alt="Square 350x350" src="https://picsum.photos/350/350" />
              <img alt="Landscape 400x300" src="https://picsum.photos/400/300" />
              <img alt="Portrait 300x400" src="https://picsum.photos/300/400" />
              <img alt="Wide 500x200" src="https://picsum.photos/500/200" />
              <img alt="Tall 200x500" src="https://picsum.photos/200/500" />
              <img alt="Square 200x200" src="https://picsum.photos/200/200" />
              <img alt="Square 220x220" src="https://picsum.photos/220/220" />
              <img alt="Square 240x240" src="https://picsum.photos/240/240" />
              <img alt="Square 260x260" src="https://picsum.photos/260/260" />
              <img alt="Square 280x280" src="https://picsum.photos/280/280" />
              <img alt="Square 300x300" src="https://picsum.photos/300/300" />
              <img alt="Landscape 450x300" src="https://picsum.photos/450/300" />
              <img alt="Portrait 300x450" src="https://picsum.photos/300/450" />
              <img alt="Square 320x320" src="https://picsum.photos/320/320" />
              <img alt="Square 340x340" src="https://picsum.photos/340/340" />
              <img alt="Square 360x360" src="https://picsum.photos/360/360" />
              <img alt="Landscape 500x400" src="https://picsum.photos/500/400" />
              <img alt="Portrait 400x500" src="https://picsum.photos/400/500" />
            </Carousel>
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
