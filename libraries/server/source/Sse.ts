import type { RouteContext } from '../types/RouteContext'
import type { SseHandler } from '../types/SseChannel'

/**
 * Bounded number of frames buffered before slow-consumer frames are dropped.
 * This caps per-connection memory instead of letting a stalled client queue
 * snapshots without limit.
 */
const HIGH_WATER_MARK = 16

/** Headers that make an SSE response stream immediately through proxies. */
const SSE_HEADERS = {
  'cache-control': 'no-store',
  'connection': 'keep-alive',
  'content-type': 'text/event-stream; charset=utf-8',
  'x-accel-buffering': 'no',
} as const

/**
 * Build a first-class Server-Sent Events response.
 *
 * The handler runs when the stream opens and receives a bounded
 * {@link SseChannel}. Client disconnect (`request.signal`) and any teardown
 * registered through `channel.onClose` both close the stream exactly once.
 * Frames are dropped once {@link HIGH_WATER_MARK} are buffered, so a slow
 * reader cannot create unbounded memory.
 * @param params - Route params parsed from the template.
 * @param context - Request context (request + server logger).
 * @param handler - The SSE route handler.
 * @returns The `text/event-stream` response.
 */
export function sseResponse<Params extends object>(
  params: Params,
  context: RouteContext,
  handler: SseHandler<Params>,
): Response {
  const encoder = new TextEncoder()
  const disposers: (() => void)[] = []
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  let detachAbort: (() => void) | null = null
  let closed = false

  const finish = (): void => {
    if (closed) return
    closed = true
    detachAbort?.()
    detachAbort = null
    while (disposers.length > 0) {
      const dispose = disposers.shift()
      try {
        dispose?.()
      } catch {
        // A failing disposer must not mask stream teardown.
      }
    }
    try {
      controller?.close()
    } catch {
      // The controller may already be closed.
    }
  }

  const channel = {
    close: finish,
    get closed(): boolean {
      return closed
    },
    onClose(disposer: () => void): void {
      if (closed) disposer()
      else disposers.push(disposer)
    },
    send(event: string, data: unknown): boolean {
      if (closed || controller === null) return false
      if (controller.desiredSize !== null && controller.desiredSize <= 0) return false
      try {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        return true
      } catch {
        finish()
        return false
      }
    },
  }

  const stream = new ReadableStream<Uint8Array>({
    cancel(): void {
      finish()
    },
    start(next): void {
      controller = next
      if (context.request.signal.aborted) {
        finish()
        return
      }
      const abort = (): void => finish()
      context.request.signal.addEventListener('abort', abort)
      detachAbort = () => context.request.signal.removeEventListener('abort', abort)

      try {
        handler(params, context, channel)
      } catch (error) {
        context.logger.error(`sse handler failed: ${error instanceof Error ? error.message : String(error)}`)
        finish()
      }
    },
  }, { highWaterMark: HIGH_WATER_MARK })

  return new Response(stream, { headers: SSE_HEADERS })
}

/**
 * Serialize one server-published event into the `{ event, data }` envelope
 * shared by the SSE and WebSocket transports.
 * @param event - Event name.
 * @param data - JSON-serializable payload.
 * @returns The serialized envelope.
 */
export function eventEnvelope(event: string, data: unknown): string {
  return JSON.stringify({ data, event })
}
