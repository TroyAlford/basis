import * as React from 'react'
import { Carousel } from '../../react/components/Carousel/Carousel'
import { Code } from '../components/Code'
import { imageURL } from '../utilities/imageURL'

export class CarouselDocs extends React.Component {
  render(): React.ReactNode {
    return (
      <>
        <h1>Carousel</h1>
        <section>
          <Carousel
            align={Carousel.Align.Center}
            altText="Kitten carousel - click to open lightbox, use arrows to navigate"
            size={Carousel.Size.Contain}
            style={{ height: `${CSS.px(300)}`, width: `${CSS.px(400)}` }}
            images={[
              imageURL(400, 300),
              imageURL(300, 300),
              imageURL(300, 400),
            ]}
          />
        </section>
        <section>
          <p>
            The Carousel component provides a responsive, accessible image carousel with built-in
            navigation, lightbox functionality, and touch support. Built on the Component base
            class, it automatically manages image preloading, navigation state, and accessibility
            features.
          </p>
          <p>
            Carousel is particularly useful for displaying image galleries, product showcases,
            and any collection of images that benefits from sequential navigation.
          </p>
        </section>
        <section>
          <h3>Basic Usage</h3>
          <p>
            Create a simple carousel with an array of image URLs:
          </p>
          {Code.format(`
            <Carousel
              images={[
                '/image1.jpg',
                '/image2.jpg',
                '/image3.jpg'
              ]}
              altText="Gallery images"
            />
          `)}
        </section>
        <section>
          <h3>Component Architecture</h3>
          <p>
            Carousel extends the Component base class and provides comprehensive image navigation:
          </p>
          <ul>
            <li><strong>Image Management:</strong> Handles both URL arrays and child Image components</li>
            <li><strong>Navigation Controls:</strong> Built-in previous/next buttons with keyboard support</li>
            <li><strong>Lightbox Mode:</strong> Full-screen viewing with enhanced navigation</li>
            <li><strong>Touch Support:</strong> Swipe gestures for mobile devices</li>
            <li><strong>Accessibility:</strong> ARIA labels, keyboard navigation, and screen reader support</li>
            <li><strong>Performance:</strong> Automatic image preloading and caching</li>
          </ul>
        </section>
        <section>
          <h3>Image Sources</h3>
          <p>
            Carousel accepts images in multiple formats for maximum flexibility:
          </p>
          <h4>URL Arrays</h4>
          <p>
            Simple array of image URLs with default settings:
          </p>
          {Code.format(`
            <Carousel
              images={[
                'https://example.com/image1.jpg',
                'https://example.com/image2.jpg',
                'https://example.com/image3.jpg'
              ]}
              altText="Product gallery"
            />
          `)}
          <h4>Image Configuration Objects</h4>
          <p>
            Detailed configuration for each image with custom alignment and sizing:
          </p>
          {Code.format(`
            <Carousel
              images={[{
                url: '/hero1.jpg',
                align: Carousel.Align.NorthWest,
                size: Carousel.Size.Fill,
                altText: 'Hero image 1'
              }, {
                url: '/hero2.jpg',
                align: Carousel.Align.Center,
                size: Carousel.Size.Contain,
                altText: 'Hero image 2'
              }]}
            />
          `)}
          <h4>Child Components</h4>
          <p>
            Use Image components as children for maximum control:
          </p>
          {Code.format(`
            <Carousel>
              <Image src="/slide1.jpg" alt="First slide" />
              <Image src="/slide2.jpg" alt="Second slide" />
              <Image src="/slide3.jpg" alt="Third slide" />
            </Carousel>
          `)}
        </section>
        <section>
          <h3>Navigation Controls</h3>
          <p>
            Carousel provides multiple ways to navigate between images:
          </p>
          {Code.format(`
            <Carousel
              images={['/img1.jpg', '/img2.jpg', '/img3.jpg']}
              onImageChange={(index) => console.log(\`Switched to image \${index}\`)}
            />
          `)}
          <p>
            Navigation methods:
          </p>
          <ul>
            <li><strong>Arrow Buttons:</strong> Previous/Next buttons with accessible labels</li>
            <li><strong>Keyboard:</strong> Left/Right arrow keys when carousel has focus</li>
            <li><strong>Touch:</strong> Swipe left/right on mobile devices</li>
            <li><strong>Mouse Wheel:</strong> Scroll to navigate between images</li>
            <li><strong>Click Navigation:</strong> Click image to open lightbox, click again to advance</li>
          </ul>
        </section>
        <section>
          <h3>Lightbox Functionality</h3>
          <p>
            Click any image to open it in a full-screen lightbox with enhanced navigation:
          </p>
          {Code.format(`
            <Carousel
              images={['/img1.jpg', '/img2.jpg', '/img3.jpg']}
              altText="Gallery images"
            />
          `)}
          <p>
            Lightbox features:
          </p>
          <ul>
            <li><strong>Full-Screen View:</strong> Images open in a modal overlay</li>
            <li><strong>Enhanced Navigation:</strong> All navigation methods work in lightbox</li>
            <li><strong>Keyboard Support:</strong> Escape key to close, arrow keys to navigate</li>
            <li><strong>Touch Support:</strong> Swipe gestures work in lightbox mode</li>
            <li><strong>Caption Display:</strong> Alt text is shown below the image</li>
            <li><strong>Close Button:</strong> Clickable × button to exit lightbox</li>
          </ul>
        </section>
        <section>
          <h3>Customization Options</h3>
          <p>
            Control the appearance and behavior with various props:
          </p>
          {Code.format(`
            <Carousel
              align={Carousel.Align.Center}        // Default alignment for all images
              size={Carousel.Size.Contain}         // Default sizing for all images
              altText="Default alt text"           // Fallback alt text
              onImageChange={handleImageChange}    // Callback when image changes
              images={imageArray}                  // Image sources
            >
              {/* Optional child Image components */}
            </Carousel>
          `)}
        </section>
        <section>
          <h2>Best Practices</h2>
          <h3>Image Organization</h3>
          <p>
            Structure your images for optimal user experience:
          </p>
          {Code.format(`
            // Good: Consistent sizing and alignment
            <Carousel
              size={Carousel.Size.Contain}
              align={Carousel.Align.Center}
              images={[
                '/product-front.jpg',
                '/product-back.jpg',
                '/product-detail.jpg'
              ]}
              altText="Product views"
            />

            // Better: Descriptive alt text for each image
            <Carousel
              images={[
                {
                  url: '/product-front.jpg',
                  altText: 'Product front view - Red leather wallet'
                },
                {
                  url: '/product-back.jpg',
                  altText: 'Product back view - Zipper closure'
                }
              ]}
            />
          `)}
        </section>
        <section>
          <h3>Accessibility</h3>
          <p>
            Ensure your carousel is accessible to all users:
          </p>
          <ul>
            <li><strong>Alt Text:</strong> Provide descriptive alt text for each image</li>
            <li><strong>Keyboard Navigation:</strong> Test navigation with keyboard only</li>
            <li><strong>Screen Readers:</strong> Verify ARIA labels and descriptions</li>
            <li><strong>Focus Management:</strong> Ensure focus returns properly when lightbox closes</li>
          </ul>
          {Code.format(`
            // Accessible carousel with proper labels
            <Carousel
              images={imageArray}
              altText="Product gallery - use arrow keys or buttons to navigate"
              onImageChange={(index) => {
                // Announce image change to screen readers
                const message = \`Image \${index + 1} of \${imageArray.length}\`
                // Use your preferred accessibility announcement method
              }}
            />
          `)}
        </section>
        <section>
          <h3>Performance Optimization</h3>
          <p>
            Leverage built-in performance features:
          </p>
          <ul>
            <li><strong>Image Preloading:</strong> All images are automatically preloaded</li>
            <li><strong>Caching:</strong> Images use the shared Image.Cache system</li>
            <li><strong>Lazy Loading:</strong> Images load as needed, not all at once</li>
          </ul>
          {Code.format(`
            // Large gallery with performance considerations
            <Carousel
              images={largeImageArray}
              onImageChange={(index) => {
                // Optionally load additional images on demand
                if (index > largeImageArray.length - 5) {
                  loadMoreImages()
                }
              }}
            />
          `)}
        </section>
        <section>
          <h3>Mobile Experience</h3>
          <p>
            Optimize for touch devices and mobile users:
          </p>
          {Code.format(`
            // Mobile-optimized carousel
            <Carousel
              images={mobileImages}
              altText="Swipe to navigate gallery"
              // Touch events are automatically handled
              // Swipe gestures work out of the box
            />
          `)}
          <p>
            Mobile features:
          </p>
          <ul>
            <li><strong>Touch Navigation:</strong> Swipe left/right to navigate</li>
            <li><strong>Responsive Design:</strong> Adapts to different screen sizes</li>
            <li><strong>Touch-Friendly Controls:</strong> Appropriately sized buttons</li>
            <li><strong>Gesture Support:</strong> Natural mobile interaction patterns</li>
          </ul>
        </section>
        <section>
          <h3>Integration Patterns</h3>
          <p>
            Combine Carousel with other components for rich experiences:
          </p>
          {Code.format(`
            // Product gallery with carousel
            <div className="product-page">
              <Carousel
                images={productImages}
                altText="Product photos"
                onImageChange={handleImageChange}
              />
              <div className="product-info">
                <h1>Product Name</h1>
                <p>Current image: {currentImageIndex + 1} of {productImages.length}</p>
              </div>
            </div>

            // Hero section with carousel
            <section className="hero">
              <Carousel
                size={Carousel.Size.Fill}
                align={Carousel.Align.Center}
                images={heroImages}
                altText="Hero images"
              />
            </section>
          `)}
        </section>
        <section>
          <h3>Benefits</h3>
          <ul>
            <li>Comprehensive image navigation system</li>
            <li>Built-in lightbox functionality</li>
            <li>Touch and keyboard support</li>
            <li>Automatic image preloading and caching</li>
            <li>Flexible image source configuration</li>
            <li>Accessibility-first design</li>
            <li>Responsive and mobile-optimized</li>
            <li>Seamless integration with Image component</li>
            <li>Performance optimized</li>
            <li>Consistent with library design principles</li>
          </ul>
        </section>
      </>
    )
  }
}
