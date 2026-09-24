import type { RouteContext } from './RouteContext'

/**
 * The server-push side of a first-class SSE route.
 *
 * `send` publishes one named event. It returns `false` when the event was
 * dropped rather than queued because the client is not reading quickly enough,
 * so a slow consumer can never grow server memory without bound.
 */
export interface SseChannel {
  /** Close the stream; idempotent. */
  close(): void,
  /** Whether the stream has been closed. */
  readonly closed: boolean,
  /**
   * Register teardown to run exactly once when the stream closes (client
   * disconnect or {@link SseChannel.close}). If the stream is already closed,
   * the disposer runs immediately.
   * @param disposer - Teardown callback.
   */
  onClose(disposer: () => void): void,
  /**
   * Publish a named event.
   * @param event - Event name (for example `snapshot`).
   * @param data - JSON-serializable payload.
   * @returns `true` when the event was queued, `false` when it was dropped.
   */
  send(event: string, data: unknown): boolean,
}

/**
 * A GET-only SSE route handler.
 *
 * The handler receives the matched route params, the request context, and the
 * {@link SseChannel}. Register teardown with {@link SseChannel.onClose}.
 * @template Params - The route params parsed from the template.
 */
export type SseHandler<Params extends object = object> = (
  params: Params,
  context: RouteContext,
  channel: SseChannel,
) => void
