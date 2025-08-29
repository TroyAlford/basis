import * as React from 'react'
import { Image } from '../../react/components/Image/Image'
import type { Align } from '../../react/types/Align'
import type { Size } from '../../react/types/Size'
import { Code } from '../components/Code'
import { imageURL } from '../utilities/imageURL'

export const ImageDocs = () => {
  const [config, setConfig] = React.useState({
    align: Image.Align.Center,
    size: Image.Size.Natural,
  })

  return (
    <>
      <h1>Image</h1>
      <section>
        <h3>Interactive Demo</h3>
        <p>
          Try different alignment and sizing options to see how they affect the image:
        </p>
        <div style={{ display: 'grid', gap: '2rem', gridTemplateColumns: '250px 1fr' }}>
          {/* Configuration Menu */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <h4>Size</h4>
              <select
                style={{ padding: '0.5rem', width: '100%' }}
                value={config.size}
                onChange={e => setConfig(prev => ({ ...prev, size: e.target.value as Size }))}
              >
                <option value={Image.Size.Natural}>Natural</option>
                <option value={Image.Size.Contain}>Contain</option>
                <option value={Image.Size.Fill}>Fill</option>
              </select>
            </div>
            <div>
              <h4>Alignment</h4>
              <select
                style={{ padding: '0.5rem', width: '100%' }}
                value={config.align}
                onChange={e => setConfig(prev => ({ ...prev, align: e.target.value as Align }))}
              >
                <option value={Image.Align.Center}>Center</option>
                <option value={Image.Align.North}>North</option>
                <option value={Image.Align.South}>South</option>
                <option value={Image.Align.East}>East</option>
                <option value={Image.Align.West}>West</option>
                <option value={Image.Align.NorthEast}>NorthEast</option>
                <option value={Image.Align.NorthWest}>NorthWest</option>
                <option value={Image.Align.SouthEast}>SouthEast</option>
                <option value={Image.Align.SouthWest}>SouthWest</option>
              </select>
            </div>
            <div style={{
              backgroundColor: '#f8f9fa',
              border: '1px solid #dee2e6',
              borderRadius: '4px',
              fontSize: '0.875rem',
              padding: '1rem',
            }}
            >
              <h5 style={{ margin: '0 0 0.5rem 0' }}>Current Settings</h5>
              <div><strong>Size:</strong> {config.size}</div>
              <div><strong>Align:</strong> {config.align}</div>
            </div>
          </div>
          {/* Image Container */}
          <div>
            <h4>Image Preview</h4>
            <div style={{
              backgroundColor: '#f8f8f8',
              border: '2px solid #e0e0e0',
              height: '300px',
              position: 'relative',
              width: '100%',
            }}
            >
              <Image
                align={config.align}
                alt="Interactive demo image"
                size={config.size}
                src={imageURL(256, 256)}
              />
            </div>
            <p style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>
              <strong>Container:</strong> 300px × 300px with visible border
            </p>
          </div>
        </div>
      </section>
      <section>
        <p>
          The Image component provides a robust, accessible way to display images with built-in
          loading states, error handling, and intelligent caching. Built on the Component base
          class, it automatically manages image loading, provides fallbacks, and ensures proper
          accessibility attributes.
        </p>
        <p>
          Image is particularly useful for applications that need reliable image display with
          loading indicators, error states, and consistent alignment and sizing options.
        </p>
      </section>
      <section>
        <h3>Basic Usage</h3>
        <p>
          Image accepts a source URL and renders with proper loading states and accessibility:
        </p>
        {Code.format(`
          <Image src="/path/to/image.jpg" alt="Description of the image" />
        `, 'tsx')}
      </section>
      <section>
        <h3>Component Architecture</h3>
        <p>Image extends the Component base class and provides intelligent image handling:</p>
        <ul>
          <li><strong>Automatic Loading:</strong> Manages image loading with built-in caching</li>
          <li><strong>Error Handling:</strong> Gracefully handles failed image loads</li>
          <li><strong>Accessibility:</strong> Provides proper ARIA attributes and alt text</li>
          <li><strong>Performance:</strong> Intelligent caching prevents duplicate requests</li>
          <li><strong>Event Handling:</strong> Supports click, touch, and mouse events</li>
          <li><strong>State Management:</strong> Tracks loading, loaded, and error states</li>
        </ul>
      </section>
      <section>
        <h3>Implementation Approach</h3>
        <p>
          The Image component uses a <code>&lt;div&gt;</code> container with background-image instead
          of <code>&lt;img&gt;</code> elements. This approach provides several advantages:
        </p>
        <ul>
          <li><strong>Better Sizing Control:</strong> Container dimensions can be explicitly controlled</li>
          <li><strong>Precise Alignment:</strong> Background positioning gives pixel-perfect control</li>
          <li><strong>Flexible Layouts:</strong> Container can be styled independently of the image</li>
          <li><strong>Performance:</strong> Maintains the same caching system for efficiency</li>
        </ul>
        <p>
          The component automatically manages the container sizing based on the selected mode, ensuring
          consistent behavior across different use cases.
        </p>
      </section>
      <section>
        <h3>Props Interface</h3>
        <p>The Image component accepts the following props:</p>
        {Code.format(`
          interface Props {
            /** Alignment value for positioning within container */
            align?: Align,
            /** Alternative text for accessibility */
            alt?: string,
            /** Click event handler */
            onClick?: (event: React.MouseEvent<HTMLImageElement>) => void,
            /** Mouse down event handler */
            onMouseDown?: (event: React.MouseEvent<HTMLImageElement>) => void,
            /** Touch end event handler */
            onTouchEnd?: (event: React.TouchEvent<HTMLImageElement>) => void,
            /** Touch move event handler */
            onTouchMove?: (event: React.TouchEvent<HTMLImageElement>) => void,
            /** Touch start event handler */
            onTouchStart?: (event: React.TouchEvent<HTMLImageElement>) => void,
            /** Size behavior for container fitting */
            size?: Size,
            /** Source URL (required) */
            src: string,
          }
        `, 'ts')}
      </section>
      <section>
        <h3>Image Alignment</h3>
        <p>Control how images are positioned within their container using the align prop:</p>
        {Code.format(`
          // Center alignment (default)
          <Image src="/image.jpg" align={Align.Center} alt="Centered image" />

          // Corner alignments
          <Image src="/image.jpg" align={Align.NorthWest} alt="Top-left image" />
          <Image src="/image.jpg" align={Align.NorthEast} alt="Top-right image" />
          <Image src="/image.jpg" align={Align.SouthWest} alt="Bottom-left image" />
          <Image src="/image.jpg" align={Align.SouthEast} alt="Bottom-right image" />

          // Edge alignments
          <Image src="/image.jpg" align={Align.North} alt="Top edge image" />
          <Image src="/image.jpg" align={Align.South} alt="Bottom edge image" />
          <Image src="/image.jpg" align={Align.East} alt="Right edge image" />
          <Image src="/image.jpg" align={Align.West} alt="Left edge image" />
        `, 'tsx')}
        <p>
          Available alignment options:
        </p>
        <ul>
          <li><strong>Center:</strong> Centers image both horizontally and vertically</li>
          <li><strong>North/South:</strong> Aligns to top or bottom edge</li>
          <li><strong>East/West:</strong> Aligns to right or left edge</li>
          <li><strong>Corners:</strong> NorthWest, NorthEast, SouthWest, SouthEast</li>
        </ul>
      </section>
      <section>
        <h3>Image Sizing</h3>
        <p>
          Control how images are sized relative to their container:
        </p>
        {Code.format(`
          // Natural size (default) - uses image's original dimensions
          <Image src="/image.jpg" size={Size.Natural} alt="Natural size" />

          // Contain - fits entirely within container, maintains aspect ratio
          <Image src="/image.jpg" size={Size.Contain} alt="Contained image" />

          // Fill - covers entire container, may crop image
          <Image src="/image.jpg" size={Size.Fill} alt="Filled image" />
        `, 'tsx')}
        <p>Size behavior:</p>
        <ul>
          <li><strong>Natural:</strong> Preserves original dimensions, may overflow container</li>
          <li><strong>Contain:</strong> Scales to fit container while maintaining proportions</li>
          <li><strong>Fill:</strong> Scales to cover container, may crop parts of image</li>
        </ul>
      </section>
      <section>
        <h3>Event Handling</h3>
        <p>Image supports various interaction events for enhanced functionality:</p>
        {Code.format(`
          <Image
            src="/image.jpg"
            alt="Interactive image"
            onClick={(event) => console.log('Image clicked')}
            onMouseDown={(event) => console.log('Mouse down')}
            onTouchStart={(event) => console.log('Touch started')}
            onTouchMove={(event) => console.log('Touch moved')}
            onTouchEnd={(event) => console.log('Touch ended')}
          />
        `, 'tsx')}
        <p>All event handlers receive the standard React event objects with proper typing.</p>
      </section>
      <section>
        <h3>Data Attributes</h3>
        <p>The Image component automatically sets data attributes for styling and state detection:</p>
        {Code.format(`
          // Automatically applied data attributes
          <Image 
            src="/image.jpg" 
            alt="Example"
            align={Align.Center}
            size={Size.Contain}
          />
          
          // Renders with these data attributes:
          // data-align="center"
          // data-size="contain"
          // data-loaded="true" (when cached)
          // data-loading="true" (while loading)
          // data-error="true" (if load failed)
        `, 'tsx')}
        <p>These attributes can be used for CSS styling based on image state:</p>
        {Code.format(`
          /* CSS examples using data attributes */
          img[data-loading="true"] {
            opacity: 0.5;
          }
          
          img[data-error="true"] {
            border: 2px solid red;
          }
          
          img[data-loaded="true"] {
            opacity: 1;
            transition: opacity 0.3s ease;
          }
        `, 'css')}
      </section>
      <section>
        <h3>Caching System</h3>
        <p>The Image component includes a sophisticated caching system for performance optimization:</p>
        {Code.format(`
          // Static cache properties
          Image.Cache.Loading  // Map of loading promises
          Image.Cache.Resolved // Map of loaded images
          
          // Cache is shared across all Image instances
          const image1 = <Image src="/logo.jpg" alt="Logo" />
          const image2 = <Image src="/logo.jpg" alt="Logo" /> // Uses cached version
        `, 'tsx')}
        <p>Benefits of the caching system:</p>
        <ul>
          <li><strong>Prevents Duplicate Requests:</strong> Same URL won't trigger multiple loads</li>
          <li><strong>Shared Across Instances:</strong> All Image components share the same cache</li>
          <li><strong>Automatic Cleanup:</strong> Loading promises are cleaned up after resolution</li>
          <li><strong>Memory Efficient:</strong> Only stores necessary image references</li>
        </ul>
      </section>
      <section>
        <h3>State Management</h3>
        <p>The component automatically manages internal state for loading, success, and error conditions:</p>
        {Code.format(`
          interface State {
            /** Error state indicating load failure */
            error: boolean,
          }
          
          // State is automatically updated during image loading lifecycle
          // error: false → loading starts → error: true (if failed)
        `, 'ts')}
        <p>
          The component automatically handles state transitions and provides visual feedback
          through data attributes.
        </p>
      </section>
      <section>
        <h2>Best Practices</h2>
        <h3>Accessibility</h3>
        <p>Always provide meaningful alt text for screen readers and accessibility:</p>
        {Code.format(`
          // Good: Descriptive alt text
          <Image src="/product.jpg" alt="Red leather wallet with silver buckle" />

          // Better: Context-aware alt text
          <Image 
            src="/product.jpg" 
            alt="Product image: Red leather wallet, $49.99" 
          />

          // Best: Functional alt text for interactive images
          <Image 
            src="/button.jpg" 
            alt="Submit order button" 
            onClick={handleSubmit}
          />
          
          // Decorative images (empty alt is acceptable)
          <Image src="/decoration.jpg" alt="" />
        `, 'tsx')}
        <p>The component automatically sets appropriate ARIA attributes based on the alt prop.</p>
      </section>
      <section>
        <h3>Performance Optimization</h3>
        <p>Leverage the built-in caching system for better performance:</p>
        <ul>
          <li><strong>Automatic Caching:</strong> Images are cached after first load</li>
          <li><strong>Prevent Duplicate Requests:</strong> Same URL won't trigger multiple loads</li>
          <li><strong>Memory Management:</strong> Cache is shared across all Image instances</li>
          <li><strong>Efficient Updates:</strong> Only re-renders when necessary</li>
        </ul>
        {Code.format(`
          // Multiple instances of the same image will share the cached version
          <div>
            <Image src="/logo.jpg" alt="Company logo" />
            <Image src="/logo.jpg" alt="Company logo" /> {/* Uses cache */}
            <Image src="/logo.jpg" alt="Company logo" /> {/* Uses cache */}
          </div>
        `, 'tsx')}
      </section>
      <section>
        <h3>Error Handling</h3>
        <p>The component automatically handles loading errors and provides visual feedback:</p>
        {Code.format(`
          // Error state is automatically managed
          <Image 
            src="/broken-image.jpg" 
            alt="This will show error state"
          />

          // You can check error state via data attributes
          <Image 
            src="/image.jpg" 
            alt="Image with error checking"
            ref={(img) => {
              if (img?.getAttribute('data-error') === 'true') {
                console.log('Image failed to load')
              }
            }}
          />
        `, 'tsx')}
        <p>
          Error handling is automatic - failed loads set the error state and data-error attribute.
        </p>
      </section>
      <section>
        <h3>Responsive Design</h3>
        <p>Combine alignment and sizing for responsive layouts:</p>
        {Code.format(`
          // Responsive hero image
          <Image 
            src="/hero.jpg" 
            alt="Hero section image"
            size={Size.Fill}
            align={Align.Center}
          />

          // Thumbnail grid
          <Image 
            src="/thumbnail.jpg" 
            alt="Product thumbnail"
            size={Size.Contain}
            align={Align.Center}
          />

          // Decorative image
          <Image 
            src="/decoration.jpg" 
            alt=""
            size={Size.Natural}
            align={Align.NorthWest}
          />
        `, 'tsx')}
      </section>
      <section>
        <h3>Integration with Other Components</h3>
        <p>Image works seamlessly with other components, particularly Carousel:</p>
        {Code.format(`
          // Image in a carousel
          <Carousel>
            <Image src="/slide1.jpg" alt="First slide" />
            <Image src="/slide2.jpg" alt="Second slide" />
            <Image src="/slide3.jpg" alt="Third slide" />
          </Carousel>

          // Image with custom styling
          <div className="image-container">
            <Image 
              src="/featured.jpg" 
              alt="Featured content"
              className="featured-image"
            />
          </div>
        `, 'tsx')}
      </section>
      <section>
        <h3>CSS Integration</h3>
        <p>Use the automatically applied data attributes for advanced styling:</p>
        {Code.format(`
          /* Loading state */
          img[data-loading="true"] {
            background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
            background-size: 200% 100%;
            animation: loading 1.5s infinite;
          }
          
          /* Error state */
          img[data-error="true"] {
            background: #f8d7da;
            border: 1px solid #f5c6cb;
          }
          
          /* Alignment-based positioning */
          img[data-align="center"] {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
          }
          
          img[data-align="north"] {
            position: absolute;
            top: 0;
            left: 50%;
            transform: translateX(-50%);
          }
        `, 'css')}
      </section>
      <section>
        <h3>TypeScript Support</h3>
        <p>The component provides full TypeScript support with proper type definitions:</p>
        {Code.format(`
          // Enums for type-safe props
          Align.Center    // 'center'
          Align.North     // 'n'
          Align.South     // 's'
          Align.East      // 'e'
          Align.West      // 'w'
          Align.NorthEast // 'ne'
          Align.NorthWest // 'nw'
          Align.SouthEast // 'se'
          Align.SouthWest // 'sw'
          
          Size.Natural    // 'natural'
          Size.Contain    // 'contain'
          Size.Fill       // 'fill'
        `, 'ts')}
      </section>
      <section>
        <h3>Benefits</h3>
        <ul>
          <li>Automatic loading state management</li>
          <li>Built-in error handling and fallbacks</li>
          <li>Intelligent caching system</li>
          <li>Comprehensive accessibility support</li>
          <li>Flexible alignment and sizing options</li>
          <li>Touch and mouse event support</li>
          <li>Performance optimized</li>
          <li>Consistent with library design principles</li>
          <li>Full TypeScript support</li>
          <li>Automatic data attributes for styling</li>
          <li>Shared cache across instances</li>
          <li>Built on Component base class</li>
        </ul>
      </section>
    </>
  )
}
