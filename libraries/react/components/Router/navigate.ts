import { NavigateEvent } from '../../events/NavigateEvent'

/**
 * Handle navigation scrolling without dispatching events
 * Used internally by Router for browser back/forward navigation
 * @param url The URL to handle scrolling for
 */
export const handleNavigationScrolling = (url: string): void => {
  const urlObj = new URL(url, window.location.origin)
  const hash = urlObj.hash

  if (hash) {
    // Hash navigation - scroll to target element
    const targetId = hash.slice(1) // Remove the #
    const targetElement = document.getElementById(targetId)
    if (targetElement) {
      targetElement.scrollIntoView({ behavior: 'smooth' })
    }
  } else {
    // No hash - scroll to top
    window.scrollTo({ top: 0 })
  }
}

/**
 * Navigate to a new URL using client-side routing
 * @param url The URL to navigate to
 */
export const navigate = (url: string): void => {
  window.history.pushState({}, '', url)
  handleNavigationScrolling(url)
  window.dispatchEvent(new NavigateEvent(url))
}
