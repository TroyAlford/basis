import { expect, test } from 'bun:test'
import { HttpVerb, Server } from './index'

test('exports HttpVerb alongside Server from the server surface', () => {
  expect(String(HttpVerb.Get)).toBe('GET')
  expect(String(HttpVerb.Post)).toBe('POST')

  const verbs: HttpVerb[] = [HttpVerb.Get]
  const server = new Server().api(verbs, 'ping', () => new Response('pong'))
  expect(server).toBeInstanceOf(Server)
})
