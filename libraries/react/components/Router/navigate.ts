import { NavigateEvent } from '../../events/NavigateEvent'

/**
 * Navigate to a new URL using client-side routing
 * @param url The URL to navigate to
 */
export const navigate = (url: string): void => {
  window.history.pushState({}, '', url)
  window.dispatchEvent(new NavigateEvent(url))
}
