import { formatMilliseconds } from '@basis/utilities'
import { Milliseconds } from '@basis/utilities/constants/Milliseconds'

export const health = () => new Response(JSON.stringify({
  bun: Bun.version,
  uptime: {
    nanoseconds: Bun.nanoseconds(),
    pretty: formatMilliseconds(Bun.nanoseconds() * Milliseconds.PerNanosecond),
  },
}), {
  headers: { 'Content-Type': 'application/json' },
  status: 200,
})
