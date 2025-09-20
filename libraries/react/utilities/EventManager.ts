type FocusEventHandler = (event: FocusEvent) => void
type BlurEventHandler = (event: FocusEvent) => void

enum Event {
  Blur = 'blur',
  Focus = 'focus',
}

interface FocusSubscription {
  element: Element,
  onBlur?: BlurEventHandler,
  onFocus?: FocusEventHandler,
}

/**
 * A singleton manager for handling focus and blur events across the application.
 * Uses native DOM events to provide accurate focus tracking.
 */
class EventManager {
  private subscriptions = new Map<Element, FocusSubscription>()
  private isListening = false

  /**
   * Registers an event handler for a specific element.
   * @param event The type of event to listen for
   * @param element The element to watch for events
   * @param handler The event handler
   * @returns A function to unsubscribe
   */
  on(event: Event, element: Element, handler: FocusEventHandler | BlurEventHandler): () => void {
    const existing = this.subscriptions.get(element) || { element }

    if (event === Event.Focus) {
      existing.onFocus = handler as FocusEventHandler
    } else if (event === Event.Blur) {
      existing.onBlur = handler as BlurEventHandler
    }

    this.subscriptions.set(element, existing)
    this.startListening()

    return () => this.unregister(element)
  }

  /**
   * Unregisters all handlers for a specific element.
   * @param element The element to unregister
   */
  private unregister(element: Element): void {
    this.subscriptions.delete(element)
    if (this.subscriptions.size === 0) {
      this.stopListening()
    }
  }

  /**
   * Starts listening for native DOM focus/blur events if not already listening.
   */
  private startListening(): void {
    if (this.isListening) return

    this.isListening = true
    document.addEventListener('focusin', this.handleFocusIn, true)
    document.addEventListener('focusout', this.handleFocusOut, true)
  }

  /**
   * Stops listening for native DOM focus/blur events.
   */
  private stopListening(): void {
    if (!this.isListening) return

    this.isListening = false
    document.removeEventListener('focusin', this.handleFocusIn, true)
    document.removeEventListener('focusout', this.handleFocusOut, true)
  }

  /**
   * Handles native focusin events.
   * @param event The event object.
   */
  private handleFocusIn = (event: FocusEvent): void => {
    for (const [element, subscription] of this.subscriptions) {
      if (subscription.onFocus && element.contains(event.target as Element)) {
        subscription.onFocus(event)
      }
    }
  }

  /**
   * Handles native focusout events.
   * @param event The event object.
   */
  private handleFocusOut = (event: FocusEvent): void => {
    for (const [element, subscription] of this.subscriptions) {
      if (subscription.onBlur && element.contains(event.target as Element)) {
        // Check if focus is moving outside this element
        if (!element.contains(event.relatedTarget as Element)) {
          subscription.onBlur(event)
        }
      }
    }
  }
}

export { Event }
export const events = new EventManager()
