import type { ServerWebSocket } from 'bun'
import type { Socket } from '../types/Socket'
import { eventEnvelope } from './Sse'

/** Data Bun carries on each upgraded socket so routes can be dispatched. */
export interface SocketData {
  /** Route params parsed from the socket template. */
  params: Record<string, string>,
  /** The template that matched this upgrade. */
  route: string,
  /** The server-side wrapper, attached when the connection opens. */
  socket: Socket | null,
}

/**
 * Wrap Bun's socket so handlers see the stable Basis {@link Socket} surface.
 * @param ws - The raw Bun server WebSocket.
 * @returns The Basis socket view.
 */
export function createSocket(ws: ServerWebSocket<SocketData>): Socket {
  return {
    close(code?: number, reason?: string): void {
      ws.close(code, reason)
    },
    get params(): Record<string, string> {
      return ws.data.params
    },
    publish(event: string, data: unknown): boolean {
      return ws.send(eventEnvelope(event, data)) >= 0
    },
    get remoteAddress(): string | null {
      return typeof ws.remoteAddress === 'string' && ws.remoteAddress.length > 0 ? ws.remoteAddress : null
    },
    send(data: string | Uint8Array): boolean {
      return ws.send(data) >= 0
    },
  }
}

/**
 * Normalize a socket template to a leading-slash path so templates match the
 * request pathname directly.
 * @param template - The configured template (`hmr`, `/hmr`, or `/room/:id`).
 * @returns The normalized template.
 */
export function normalizeSocketTemplate(template: string): string {
  return template.startsWith('/') ? template : `/${template}`
}
