import { parseMilliseconds } from '@basis/utilities'

const formatMilliseconds = (ms: number): string => {
  const { years, weeks, days, hours, minutes, seconds } = parseMilliseconds(ms)
  return [
    years && `${years}y`,
    weeks && `${weeks}w`,
    days && `${days}d`,
    hours && `${hours}h`,
    minutes && `${minutes}m`,
    seconds && `${seconds}s`,
  ].filter(Boolean).join(' ')
}


export const health = () => new Response(JSON.stringify({
  bun: Bun.version,
  uptime: {
    nanoseconds: Bun.nanoseconds(),
    pretty: formatMilliseconds(Bun.nanoseconds() / 1_000_000),
  },
}),{
  headers: { 'Content-Type': 'application/json' },
  status: 200,
})
