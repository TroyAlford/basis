#!/usr/bin/env bun

import { mkdirSync, readdirSync, writeFileSync } from 'fs'
import { basename, extname, join } from 'path'
import React from 'react'
import { renderToString } from 'react-dom/server'
import SVGPathCommander from 'svg-path-commander'

/**
 * Icon Renderer and SVG Coordinate Transformer
 *
 * This script renders React icon components to SVG files and transforms them
 * to the standardized viewBox: -100 -100 200 200
 *
 * Usage: bun run scripts/transformSVGs.ts
 *
 * Features:
 * - Renders React icon components to pure SVG strings
 * - Transforms SVG coordinates using SVGPathCommander from esm.sh
 * - Handles path data, coordinates, radius, dimensions, and animations
 * - Outputs transformed SVG files to temp/svgs/ directory
 */

interface ViewBox {
  height: number,
  width: number,
  x: number,
  y: number,
}

class IconRendererAndTransformer {
  private tempDir = join(process.cwd(), 'temp', 'svgs')
  private targetViewBox: ViewBox = { height: 200, width: 200, x: -100, y: -100 }

  /**
   * Ensure temp directory exists
   */
  private ensureTempDir(): void {
    try {
      mkdirSync(this.tempDir, { recursive: true })
    } catch {
      // Directory might already exist
    }
  }

  /**
   * Parse viewBox string into ViewBox type
   * @param viewBoxString - The viewBox string to parse (e.g., "0 0 100 100")
   * @returns Parsed ViewBox object
   */
  private parseViewBox(viewBoxString: string): ViewBox {
    const parts = viewBoxString.trim().split(/\s+/)
    if (parts.length !== 4) {
      throw new Error(`Invalid viewBox format: ${viewBoxString}`)
    }

    return {
      height: parseFloat(parts[3]),
      width: parseFloat(parts[2]),
      x: parseFloat(parts[0]),
      y: parseFloat(parts[1]),
    }
  }

  /**
   * Convert ViewBox type back to string
   * @param viewBox - The ViewBox object to convert
   * @returns ViewBox string (e.g., "0 0 100 100")
   */
  private viewBoxToString(viewBox: ViewBox): string {
    return `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`
  }

  /**
   * Calculate transformation parameters from source to target viewBox
   * @param sourceViewBox - The source viewBox to transform from
   * @returns Transformation parameters for scaling and translation
   */
  private calculateTransformation(sourceViewBox: ViewBox): {
    scaleX: number,
    scaleY: number,
    translateX: number,
    translateY: number,
  } {
    // Use uniform scaling to preserve aspect ratio
    const scaleX = this.targetViewBox.width / sourceViewBox.width
    const scaleY = this.targetViewBox.height / sourceViewBox.height
    const uniformScale = Math.min(scaleX, scaleY) // Use the smaller scale to fit within target

    // Calculate the scaled dimensions
    const scaledWidth = sourceViewBox.width * uniformScale
    const scaledHeight = sourceViewBox.height * uniformScale

    // Center the scaled content within the target viewBox
    const translateX = this.targetViewBox.x + ((this.targetViewBox.width - scaledWidth) / 2) -
      (sourceViewBox.x * uniformScale)
    const translateY = this.targetViewBox.y + ((this.targetViewBox.height - scaledHeight) / 2) -
      (sourceViewBox.y * uniformScale)

    return { scaleX: uniformScale, scaleY: uniformScale, translateX, translateY }
  }

  /**
   * Transform animation values based on the attribute being animated
   * @param values - The semicolon-separated animation values
   * @param attributeName - The name of the attribute being animated
   * @param scaleX - X-axis scale factor
   * @param scaleY - Y-axis scale factor
   * @param translateX - X-axis translation offset
   * @param translateY - Y-axis translation offset
   * @returns Transformed animation values string
   */
  private transformAnimationValues(
    values: string,
    attributeName: string,
    scaleX: number,
    scaleY: number,
    translateX: number,
    translateY: number,
  ): string {
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
          return ((num * scaleX) + translateX).toString()
        case 'y':
        case 'cy':
          return ((num * scaleY) + translateY).toString()
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
   * @param svgString - The SVG string to transform
   * @returns Transformed SVG string
   */
  private transformSVGString(svgString: string): string {
    // Extract current viewBox
    const viewBoxMatch = svgString.match(/viewBox\s*=\s*['"`]([^'"`]+)['"`]/)
    if (!viewBoxMatch) {
      // eslint-disable-next-line no-console
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
          translate: [translateX, translateY],
        })

        const transformedPath = pathCommander.toString()
        return `d="${transformedPath}"`
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn(`Error transforming path data: ${pathData}`, error)
        return match
      }
    })

    // Transform coordinate attributes (but NOT in viewBox)
    const coordinateAttrs = ['x', 'y', 'cx', 'cy']
    coordinateAttrs.forEach(attr => {
      // Use negative lookbehind to avoid matching viewBox attributes
      const regex = new RegExp(
        `(?<!viewBox\\s*=\\s*['"\`][^'"\`]*)\\b${attr}\\s*=\\s*['"\`]([^'"\`]+)['"\`]`,
        'g',
      )
      transformed = transformed.replace(regex, (match, value) => {
        const num = parseFloat(value)
        if (!isNaN(num)) {
          const transformedValue = attr === 'x' || attr === 'cx'
            ? (num * scaleX) + translateX
            : (num * scaleY) + translateY
          return `${attr}="${transformedValue}"`
        }
        return match
      })
    })

    // Transform radius attributes
    const radiusAttrs = ['r', 'rx', 'ry']
    radiusAttrs.forEach(attr => {
      const regex = new RegExp(`${attr}\\s*=\\s*['"\`]([^'"\`]+)['"\`]`, 'g')
      transformed = transformed.replace(regex, (match, value) => {
        const num = parseFloat(value)
        if (!isNaN(num)) {
          const transformedValue = num * Math.sqrt(scaleX * scaleY) // Geometric mean for radius
          return `${attr}="${transformedValue}"`
        }
        return match
      })
    })

    // Transform dimension attributes
    const dimensionAttrs = ['width', 'height']
    dimensionAttrs.forEach(attr => {
      const regex = new RegExp(`${attr}\\s*=\\s*['"\`]([^'"\`]+)['"\`]`, 'g')
      transformed = transformed.replace(regex, (match, value) => {
        const num = parseFloat(value)
        if (!isNaN(num)) {
          const transformedValue = attr === 'width' ? num * scaleX : num * scaleY
          return `${attr}="${transformedValue}"`
        }
        return match
      })
    })

    // Transform animation values - enhanced to handle animate elements!
    const animateRegex = new RegExp(
      '<animate[^>]*attributeName\\s*=\\s*[\'"`]([^\'"`]+)[\'"`][^>]*values\\s*=\\s*[\'"`]([^\'"`]+)[\'"`][^>]*>',
      'g',
    )
    transformed = transformed.replace(animateRegex, (match, attributeName, values) => {
      const transformedValues = this.transformAnimationValues(
        values,
        attributeName,
        scaleX,
        scaleY,
        translateX,
        translateY,
      )
      return match.replace(/values\s*=\s*['"`]([^'"`]+)['"`]/, `values="${transformedValues}"`)
    })

    return transformed
  }

  /**
   * Render a single icon to SVG string
   * @param iconPath - Path to the icon component file
   * @returns Promise that resolves to the rendered SVG string
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
        throw new Error('No full SVG found in rendered string')
      }

      return fullSvgMatch[0]

    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Error rendering ${iconPath}:`, error)
      return ''
    }
  }

  /**
   * Process a single icon file
   * @param filePath - Path to the icon file to process
   * @returns Promise that resolves when processing is complete
   */
  private async processIconFile(filePath: string): Promise<void> {
    try {
      const fileName = basename(filePath, '.tsx')
      const svgPath = join(this.tempDir, `${fileName}.svg`)

      // eslint-disable-next-line no-console
      console.log(`🔄 Rendering and transforming ${fileName}...`)

      // Render icon to SVG
      const svgContent = await this.renderIconToSVG(filePath)
      if (!svgContent) {
        // eslint-disable-next-line no-console
        console.warn(`Failed to render ${fileName}`)
        return
      }

      // Extract current viewBox for logging
      const viewBoxMatch = svgContent.match(/viewBox\s*=\s*['"`]([^'"`]+)['"`]/)
      if (viewBoxMatch) {
        const sourceViewBox = this.parseViewBox(viewBoxMatch[1])
        // eslint-disable-next-line no-console
        console.log(`📐 Source viewBox: ${this.viewBoxToString(sourceViewBox)}`)
      }

      // Transform SVG coordinates
      const transformedContent = this.transformSVGString(svgContent)

      // Write transformed SVG file
      writeFileSync(svgPath, transformedContent, 'utf-8')

      // eslint-disable-next-line no-console
      console.log(`✅ Rendered and transformed ${fileName} → ${svgPath}`)
      // eslint-disable-next-line no-console
      console.log(`   ${viewBoxMatch?.[1] || 'unknown'} → ${this.viewBoxToString(this.targetViewBox)}`)
      // eslint-disable-next-line no-console
      console.log('')

    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Error processing ${filePath}:`, error)
    }
  }

  /**
   * Process all icon files
   * @param iconsDir - Directory containing icon files
   * @returns Promise that resolves when all icons are processed
   */
  async processAllIcons(iconsDir: string): Promise<void> {
    // eslint-disable-next-line no-console
    console.log('🎨 Starting icon rendering and transformation...')
    // eslint-disable-next-line no-console
    console.log(`Target viewBox: ${this.viewBoxToString(this.targetViewBox)}`)
    // eslint-disable-next-line no-console
    console.log(`📁 Output directory: ${this.tempDir}`)
    // eslint-disable-next-line no-console
    console.log('📝 Note: Enhanced to handle animate elements and values attributes')
    // eslint-disable-next-line no-console
    console.log('')

    this.ensureTempDir()

    const files = readdirSync(iconsDir)
    const iconFiles = files.filter(file => extname(file) === '.tsx'
      && !file.includes('IconBase')
      && !file.includes('Icon.tsx')
      && !file.includes('index.ts')
      && !file.includes('test'))

    // eslint-disable-next-line no-console
    console.log(`Found ${iconFiles.length} icon files to process`)
    // eslint-disable-next-line no-console
    console.log('')

    for (const file of iconFiles) {
      const filePath = join(iconsDir, file)
      await this.processIconFile(filePath)
    }

    // eslint-disable-next-line no-console
    console.log('🎉 Icon rendering and transformation complete!')
    // eslint-disable-next-line no-console
    console.log(`📊 Processed ${iconFiles.length} icons`)
  }
}

// Main execution
if (import.meta.main) {
  const iconsDir = join(process.cwd(), 'libraries', 'icons')
  const renderer = new IconRendererAndTransformer()
  renderer.processAllIcons(iconsDir).catch(error => {
    // eslint-disable-next-line no-console
    console.error(error)
  })
}
