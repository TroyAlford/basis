/** One server-published event delivered to a client subscription. */
export interface ServerEvent {
  /** JSON-decoded payload. */
  data: unknown,
  /** Event name (for example `snapshot`). */
  event: string,
}

/** Connection status shared by the SSE and WebSocket transports. */
export type ServerEventsStatus = 'closed' | 'connecting' | 'open'

/**
 * Parse a server-published `{ event, data }` envelope.
 *
 * Both transports write the same envelope. A frame that is not an envelope is
 * surfaced as a `message` event so plain payloads keep working.
 * @param raw - The raw frame text.
 * @returns The parsed event, or `null` for an empty frame.
 */
export function parseServerEvent(raw: string): ServerEvent | null {
  if (raw.length === 0) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { data: parsed, event: 'message' }
    }
    const record = parsed as Record<string, unknown>
    return {
      data: 'data' in record ? record.data : parsed,
      event: typeof record.event === 'string' && record.event.length > 0 ? record.event : 'message',
    }
  } catch {
    return { data: raw, event: 'message' }
  }
}
