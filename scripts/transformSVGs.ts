#!/usr/bin/env bun

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'fs'
import { join, extname, basename } from 'path'
import React from 'react'
import { renderToString } from 'react-dom/server'
import SVGPathCommander from 'svg-path-commander'

/**
 * Combined Icon Renderer and SVG Coordinate Transformer
 * 
 * This script renders React icon components to SVG files and immediately
 * transforms them to the standardized viewBox: -100 -100 200 200
 * 
 * CANONICAL WORKFLOW:
 * 1. render-and-transform-icons.ts - Render and transform icons (THIS SCRIPT)
 * 2. check-viewboxes.ts          - Verify which icons need updating
 * 3. Manual application          - Apply transformed content back to .tsx files manually
 * 
 * Enhanced to handle:
 * - Path data transformation using SVGPathCommander
 * - Coordinate attributes (x, y, cx, cy)
 * - Radius attributes (r, rx, ry) 
 * - Dimension attributes (width, height)
 * - Animation values in <animate> elements
 */

interface ViewBox {
  x: number
  y: number
  width: number
  height: number
}

class IconRendererAndTransformer {
  private tempDir = join(process.cwd(), 'temp', 'svgs')
  private targetViewBox: ViewBox = { x: -100, y: -100, width: 200, height: 200 }

  /**
   * Ensure temp directory exists
   */
  private ensureTempDir(): void {
    try {
      mkdirSync(this.tempDir, { recursive: true })
    } catch (error) {
      // Directory might already exist
    }
  }

  /**
   * Parse viewBox string into ViewBox type
   */
  private parseViewBox(viewBoxString: string): ViewBox {
    const parts = viewBoxString.trim().split(/\s+/)
    if (parts.length !== 4) {
      throw new Error(`Invalid viewBox format: ${viewBoxString}`)
    }

    return {
      x: parseFloat(parts[0]),
      y: parseFloat(parts[1]),
      width: parseFloat(parts[2]),
      height: parseFloat(parts[3])
    }
  }

  /**
   * Convert ViewBox type back to string
   */
  private viewBoxToString(viewBox: ViewBox): string {
    return `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`
  }

  /**
   * Calculate transformation parameters from source to target viewBox
   */
  private calculateTransformation(sourceViewBox: ViewBox): { scaleX: number, scaleY: number, translateX: number, translateY: number } {
    // Use uniform scaling to preserve aspect ratio
    const scaleX = this.targetViewBox.width / sourceViewBox.width
    const scaleY = this.targetViewBox.height / sourceViewBox.height
    const uniformScale = Math.min(scaleX, scaleY) // Use the smaller scale to fit within target

    // Calculate the scaled dimensions
    const scaledWidth = sourceViewBox.width * uniformScale
    const scaledHeight = sourceViewBox.height * uniformScale

    // Center the scaled content within the target viewBox
    const translateX = this.targetViewBox.x + (this.targetViewBox.width - scaledWidth) / 2 - (sourceViewBox.x * uniformScale)
    const translateY = this.targetViewBox.y + (this.targetViewBox.height - scaledHeight) / 2 - (sourceViewBox.y * uniformScale)

    return { scaleX: uniformScale, scaleY: uniformScale, translateX, translateY }
  }

  /**
   * Transform animation values based on the attribute being animated
   */
  private transformAnimationValues(values: string, attributeName: string, scaleX: number, scaleY: number, translateX: number, translateY: number): string {
    // Split values by semicolon and transform each value
    const valueList = values.split(';').map(v => v.trim())

    const transformedValues = valueList.map(value => {
      const num = parseFloat(value)
      if (isNaN(num)) {
        return value // Return original if not a number
      }

      // Transform based on the attribute being animated
      switch (attributeName) {
        case 'x':
        case 'cx':
          return (num * scaleX + translateX).toString()
        case 'y':
        case 'cy':
          return (num * scaleY + translateY).toString()
        case 'width':
          return (num * scaleX).toString()
        case 'height':
          return (num * scaleY).toString()
        case 'r':
        case 'rx':
        case 'ry':
          return (num * Math.sqrt(scaleX * scaleY)).toString()
        default:
          return value // Return original for other attributes
      }
    })

    return transformedValues.join('; ')
  }

  /**
   * Transform SVG string with proper coordinate transformation using SVGPathCommander
   * Enhanced to handle animate elements and their values attributes
   */
  private transformSVGString(svgString: string): string {
    // Extract current viewBox
    const viewBoxMatch = svgString.match(/viewBox\s*=\s*['"`]([^'"`]+)['"`]/)
    if (!viewBoxMatch) {
      console.warn('No viewBox found in SVG')
      return svgString
    }

    const sourceViewBoxString = viewBoxMatch[1]
    const sourceViewBox = this.parseViewBox(sourceViewBoxString)
    const { scaleX, scaleY, translateX, translateY } = this.calculateTransformation(sourceViewBox)

    let transformed = svgString

    // Update viewBox FIRST - before any other transformations
    const targetViewBoxString = this.viewBoxToString(this.targetViewBox)
    transformed = transformed.replace(/viewBox\s*=\s*['"`]([^'"`]+)['"`]/, `viewBox="${targetViewBoxString}"`)

    // Transform path data using SVGPathCommander
    transformed = transformed.replace(/d\s*=\s*['"`]([^'"`]+)['"`]/g, (match, pathData) => {
      try {
        const pathCommander = new SVGPathCommander(pathData)

        // Apply transformation matrix: scale then translate
        pathCommander.transform({
          scale: [scaleX, scaleY],
          translate: [translateX, translateY]
        })

        const transformedPath = pathCommander.toString()
        return `d="${transformedPath}"`
      } catch (error) {
        console.warn(`Error transforming path data: ${pathData}`, error)
        return match
      }
    })

    // Transform coordinate attributes (but NOT in viewBox)
    const coordinateAttrs = ['x', 'y', 'cx', 'cy']
    coordinateAttrs.forEach(attr => {
      // Use negative lookbehind to avoid matching viewBox attributes
      transformed = transformed.replace(new RegExp(`(?<!viewBox\\s*=\\s*['"\`][^'"\`]*)\\b${attr}\\s*=\\s*['"\`]([^'"\`]+)['"\`]`, 'g'), (match, value) => {
        const num = parseFloat(value)
        if (!isNaN(num)) {
          const transformed = attr === 'x' || attr === 'cx'
            ? num * scaleX + translateX
            : num * scaleY + translateY
          return `${attr}="${transformed}"`
        }
        return match
      })
    })

    // Transform radius attributes
    const radiusAttrs = ['r', 'rx', 'ry']
    radiusAttrs.forEach(attr => {
      transformed = transformed.replace(new RegExp(`${attr}\\s*=\\s*['"\`]([^'"\`]+)['"\`]`, 'g'), (match, value) => {
        const num = parseFloat(value)
        if (!isNaN(num)) {
          const transformed = num * Math.sqrt(scaleX * scaleY) // Geometric mean for radius
          return `${attr}="${transformed}"`
        }
        return match
      })
    })

    // Transform dimension attributes
    const dimensionAttrs = ['width', 'height']
    dimensionAttrs.forEach(attr => {
      transformed = transformed.replace(new RegExp(`${attr}\\s*=\\s*['"\`]([^'"\`]+)['"\`]`, 'g'), (match, value) => {
        const num = parseFloat(value)
        if (!isNaN(num)) {
          const transformed = attr === 'width' ? num * scaleX : num * scaleY
          return `${attr}="${transformed}"`
        }
        return match
      })
    })

    // Transform animation values - enhanced to handle animate elements!
    transformed = transformed.replace(/<animate[^>]*attributeName\s*=\s*['"`]([^'"`]+)['"`][^>]*values\s*=\s*['"`]([^'"`]+)['"`][^>]*>/g, (match, attributeName, values) => {
      const transformedValues = this.transformAnimationValues(values, attributeName, scaleX, scaleY, translateX, translateY)
      return match.replace(/values\s*=\s*['"`]([^'"`]+)['"`]/, `values="${transformedValues}"`)
    })

    return transformed
  }

  /**
   * Render a single icon to SVG string
   */
  private async renderIconToSVG(iconPath: string): Promise<string> {
    try {
      // Import the icon component
      const iconModule = await import(iconPath)
      const IconComponent = iconModule.default || Object.values(iconModule)[0]

      if (!IconComponent) {
        throw new Error(`No default export found in ${iconPath}`)
      }

      // Render to string
      const svgString = renderToString(React.createElement(IconComponent, {}))

      // Get the full SVG with proper attributes
      const fullSvgMatch = svgString.match(/<svg[^>]*>[\s\S]*?<\/svg>/)
      if (!fullSvgMatch) {
        throw new Error(`No full SVG found in rendered string`)
      }

      return fullSvgMatch[0]

    } catch (error) {
      console.error(`Error rendering ${iconPath}:`, error)
      return ''
    }
  }

  /**
   * Process a single icon file
   */
  private async processIconFile(filePath: string): Promise<void> {
    try {
      const fileName = basename(filePath, '.tsx')
      const svgPath = join(this.tempDir, `${fileName}.svg`)

      console.log(`🔄 Rendering and transforming ${fileName}...`)

      // Render icon to SVG
      const svgContent = await this.renderIconToSVG(filePath)
      if (!svgContent) {
        console.warn(`Failed to render ${fileName}`)
        return
      }

      // Extract current viewBox for logging
      const viewBoxMatch = svgContent.match(/viewBox\s*=\s*['"`]([^'"`]+)['"`]/)
      if (viewBoxMatch) {
        const sourceViewBox = this.parseViewBox(viewBoxMatch[1])
        console.log(`📐 Source viewBox: ${this.viewBoxToString(sourceViewBox)}`)
      }

      // Transform SVG coordinates
      const transformedContent = this.transformSVGString(svgContent)

      // Write transformed SVG file
      writeFileSync(svgPath, transformedContent, 'utf-8')

      console.log(`✅ Rendered and transformed ${fileName} → ${svgPath}`)
      console.log(`   ${viewBoxMatch?.[1] || 'unknown'} → ${this.viewBoxToString(this.targetViewBox)}`)
      console.log('')

    } catch (error) {
      console.error(`Error processing ${filePath}:`, error)
    }
  }

  /**
   * Process all icon files
   */
  async processAllIcons(iconsDir: string): Promise<void> {
    console.log('🎨 Starting icon rendering and transformation...')
    console.log(`Target viewBox: ${this.viewBoxToString(this.targetViewBox)}`)
    console.log(`📁 Output directory: ${this.tempDir}`)
    console.log('📝 Note: Enhanced to handle animate elements and values attributes')
    console.log('')

    this.ensureTempDir()

    const files = readdirSync(iconsDir)
    const iconFiles = files.filter(file =>
      extname(file) === '.tsx' &&
      !file.includes('IconBase') &&
      !file.includes('Icon.tsx') &&
      !file.includes('index.ts') &&
      !file.includes('test')
    )

    console.log(`Found ${iconFiles.length} icon files to process`)
    console.log('')

    for (const file of iconFiles) {
      const filePath = join(iconsDir, file)
      await this.processIconFile(filePath)
    }

    console.log('🎉 Icon rendering and transformation complete!')
    console.log(`📊 Processed ${iconFiles.length} icons`)
  }
}

// Main execution
if (import.meta.main) {
  const iconsDir = join(process.cwd(), 'libraries', 'icons')
  const renderer = new IconRendererAndTransformer()
  renderer.processAllIcons(iconsDir).catch(console.error)
}
