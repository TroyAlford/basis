import type { DocumentationEntry } from 'basis/react'
import { ApplicationBase, Basis, buildDocumentationNavigation, Documentation, Theme } from 'basis/react'
import type { ComponentType, ReactNode } from 'react'
import { routes } from '../routes.ts'
import { highlight } from './Code.tsx'

/**
 * The docs application shell. It composes the shared {@link Documentation}
 * surface — the same one the static documentation build renders — so the
 * gallery and the published documentation have one presentation.
 */
export class Layout extends ApplicationBase {
  static displayName = 'Layout'

  #observer?: MutationObserver

  protected get routes(): Record<string, { component: ComponentType<unknown> }> {
    return Object.fromEntries(
      routes.filter(route => !route.section).map(route => [route.path, { component: route.component }]),
    )
  }

  /**
   * The navigation tree, nested by each route's declared parent.
   * @returns The navigation entries.
   */
  protected get navigation(): DocumentationEntry[] {
    return buildDocumentationNavigation(routes.map(route => ({
      href: route.path,
      parent: route.parent,
      section: route.section,
      title: route.title.split('/').pop() ?? route.title,
    })))
  }

  override componentDidMount(): void {
    super.componentDidMount()
    this.#observer = new MutationObserver(() => void this.highlightCodeBlocks())
    this.#observer.observe(document.body, { childList: true, subtree: true })
    void this.highlightCodeBlocks()
  }

  override componentWillUnmount(): void {
    this.#observer?.disconnect()
    super.componentWillUnmount()
  }

  /**
   * Upgrade Markdown fences in the rendered article to Shiki-highlighted code.
   * React page code examples already render through the Code component, so they
   * are skipped here and highlighted by that component instead.
   * @returns A promise that settles after every visible fence is processed.
   */
  private async highlightCodeBlocks(): Promise<void> {
    if (typeof document === 'undefined') return

    const blocks = document.querySelectorAll<HTMLElement>(
      '.documentation-shell main pre:not(.shiki) > code:not([data-basis-highlighted])',
    )

    for (const code of blocks) {
      const pre = code.parentElement
      if (!pre || pre.closest('.code.component')) continue

      code.dataset.basisHighlighted = 'true'
      const language = code.className.match(/(?:^|\s)language-([\w-]+)/)?.[1] ?? 'text'

      try {
        const html = await highlight(code.textContent ?? '', language)
        if (html && pre.isConnected) this.applyHighlight(pre, code, html)
      } catch {
        /* Leave the readable source in place when the highlighter is unavailable. */
      }
    }
  }

  /**
   * Apply Shiki markup without replacing React-owned host nodes. Replacing the
   * fence with `outerHTML` leaves React's fiber pointing at a detached node,
   * which breaks removal on the next route change.
   * @param pre - The React-owned pre element.
   * @param code - The React-owned code element.
   * @param html - Shiki HTML for the fence.
   */
  private applyHighlight(pre: HTMLElement, code: HTMLElement, html: string): void {
    const template = document.createElement('template')
    template.innerHTML = html

    const shikiPre = template.content.firstElementChild
    const shikiCode = shikiPre?.querySelector('code')
    if (!(shikiPre instanceof HTMLElement) || !(shikiCode instanceof HTMLElement)) return

    for (const attribute of Array.from(shikiPre.attributes)) {
      pre.setAttribute(attribute.name, attribute.value)
    }

    /*
     * Keep React's text node in the tree, but empty it before moving Shiki's
     * token nodes into the code element.
     */
    for (const child of Array.from(code.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) child.nodeValue = ''
    }
    for (const child of Array.from(shikiCode.childNodes)) code.appendChild(child)
  }

  protected layout(content: ReactNode): ReactNode {
    const active = typeof window === 'undefined' ? undefined : window.location.pathname
    return (
      <>
        <Theme />
        <Documentation active={active} icon={<Basis />} navigation={this.navigation} title="Basis Docs">
          {content}
        </Documentation>
      </>
    )
  }

  protected route(outlet: ReactNode): ReactNode {
    return outlet
  }
}
