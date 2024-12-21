/**
 * Returns a response with the PONG message.
 * @returns A PONG! response, useful for keepalive checks.
 */
export const ping = (): Response => new Response('PONG!', { status: 200 })
