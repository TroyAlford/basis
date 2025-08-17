/**
 * Style utility for injecting CSS into the document head
 *
 * This module provides a simple way to inject CSS styles into the document head
 * with a unique identifier. It's designed for component-level styling where you
 * want to ensure styles are only injected once per component/module.
 */

/**
 * Creates or updates a style tag with the given ID and CSS content
 *
 * This function will:
 * - Check if a style tag with the given ID already exists in document.head
 * - Create a new style tag if one doesn't exist
 * - Update the text content of the style tag with the provided CSS
 *
 * The style tag will be created with a `data-injected-by` attribute for debugging.
 * @param id - Unique identifier for the style tag. Should be descriptive and unique
 *             across your application to avoid conflicts.
 * @param cssString - CSS content to inject into the style tag. Can be a plain string
 *                   or the result of the `css` template literal.
 * @example
 * ```typescript
 * // Basic usage with plain string
 * style('my-component', '.my-component { color: red; }')
 *
 * // Usage with css template literal for syntax highlighting
 * style('button-styles', css`
 *   .btn {
 *     padding: 8px 16px;
 *     border-radius: 4px;
 *   }
 *
 *   .btn-primary {
 *     background: #007bff;
 *     color: white;
 *   }
 * `)
 *
 * // Component-specific styles
 * const headerStyles = css`
 *   .header {
 *     font-size: 24px;
 *     font-weight: bold;
 *     margin-bottom: 16px;
 *   }
 * `
 * style('header-component', headerStyles)
 * ```
 */
export function style(id: string, cssString: string): void {
  if (typeof globalThis.document === 'undefined') return // support for SSR
  if (!document.head) return // wait for DOM to be ready

  let styleElement = document.getElementById(id) as HTMLStyleElement | null

  if (!styleElement) {
    styleElement = document.createElement('style')
    styleElement.id = id
    styleElement.setAttribute('data-injected-by', 'style-utility')
    document.head.appendChild(styleElement)
  }

  styleElement.textContent = cssString
}

/**
 * CSS template literal for syntax highlighting
 *
 * This is a simple wrapper around `String.raw` that provides CSS syntax highlighting
 * in your editor without any interpolation logic. It returns the raw string as-is.
 *
 * Use this with the `style()` function to get proper CSS syntax highlighting
 * while maintaining a clean API.
 * @param strings - Template literal strings
 * @param replacements - Template literal replacements (unused, but required for type compatibility)
 * @returns The raw CSS string without any interpolation
 * @example
 * ```typescript
 * // Basic usage
 * const styles = css`
 *   .my-class {
 *     color: blue;
 *     font-size: 16px;
 *   }
 * `
 *
 * // With the style function
 * style('my-styles', css`
 *   .container {
 *     max-width: 1200px;
 *     margin: 0 auto;
 *     padding: 0 16px;
 *   }
 *
 *   .container > * {
 *     margin-bottom: 16px;
 *   }
 * `)
 * ```
 */
export const css = String.raw
