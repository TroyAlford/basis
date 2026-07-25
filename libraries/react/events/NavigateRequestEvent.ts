/** Dispatched to request client-side navigation (handled by {@link Router}). */
export class NavigateRequestEvent extends CustomEvent<{ url: string }> {
  static name = 'basis:router:navigate-request'

  constructor(url: string) {
    super(NavigateRequestEvent.name, { cancelable: true, detail: { url } })
  }
}

type NavigateHandler = (url: string) => Promise<boolean>

let navigateHandler: NavigateHandler | null = null

/**
 * Registers the handler that performs client-side navigation.
 * @param handler Function invoked when a {@link NavigateRequestEvent} is dispatched
 */
export function registerNavigateHandler(handler: NavigateHandler): void {
  navigateHandler = handler
}

/**
 * Routes a navigate-request event to the registered handler.
 * @param event The navigate request event
 */
function handleNavigateRequest(event: Event): void {
  if (event instanceof NavigateRequestEvent && navigateHandler !== null) {
    void navigateHandler(event.detail.url)
  }
}

/**
 * Ensures the current `window` listens for {@link NavigateRequestEvent}.
 * Re-run after test environments replace `global.window`.
 */
export function ensureNavigateRequestListener(): void {
  if (typeof window === 'undefined') return

  const flaggedWindow = window as Window & { __basisNavigateRequestListener?: boolean }
  if (flaggedWindow.__basisNavigateRequestListener) return

  window.addEventListener(NavigateRequestEvent.name, handleNavigateRequest)
  flaggedWindow.__basisNavigateRequestListener = true
}
