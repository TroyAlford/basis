/**
 * Thrown by {@link Dialog.open}, {@link Dialog.confirm}, and {@link Notification.create} when no
 * {@link OverlayProvider} is mounted on `window.overlayProvider`.
 */
export const REQUIRED_MESSAGE = 'A mounted OverlayProvider is required.'
