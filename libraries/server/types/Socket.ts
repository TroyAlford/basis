/**
 * A server-side view of one connected WebSocket client.
 *
 * `publish` writes the same `{ event, data }` envelope the client transport
 * (`ServerSocket`) consumes, so SSE and WebSocket publish symmetrically.
 */
export interface Socket {
  /**
   * Close the connection.
   * @param code - Optional WebSocket close code.
   * @param reason - Optional human-readable reason.
   */
  close(code?: number, reason?: string): void,
  /** Route params parsed from the socket template. */
  readonly params: Record<string, string>,
  /**
   * Publish a named event using the standard `{ event, data }` envelope.
   * @param event - Event name.
   * @param data - JSON-serializable payload.
   * @returns `true` when the frame was accepted for sending.
   */
  publish(event: string, data: unknown): boolean,
  /** The client's remote address, or `null` when unavailable. */
  readonly remoteAddress: string | null,
  /**
   * Send a raw frame.
   * @param data - Text or binary payload.
   * @returns `true` when the frame was accepted for sending.
   */
  send(data: string | Uint8Array): boolean,
}

/** Lifecycle handlers for a first-class WebSocket route. */
export interface SocketHandlers {
  /** Called when a client disconnects. */
  close?(socket: Socket, code: number, reason: string): void,
  /**
   * Called for each inbound frame.
   * @param socket - The connected client.
   * @param data - Text or binary frame.
   */
  message?(socket: Socket, data: string | Uint8Array): void,
  /** Called when a client connects. */
  open?(socket: Socket): void,
}
